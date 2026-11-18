"""Per feeder problem tracking: device faults and planned meals that never came.

Missed meals: a minute after each planned meal's grace period ends, check that
the feeder's feed_state entity turned on since shortly before the meal time.
If not, the meal counts as missed until the next feeding. Meals planned before
Home Assistant started are skipped, so a restart never causes a false alarm.

Faults: DP 19 bitmap from the raw Tuya reports (see plan.FAULTS).
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timedelta
import logging
from typing import Any

from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers.event import async_track_state_change_event, async_track_time_change
from homeassistant.util import dt as dt_util

from .plan import decode_faults, decode_plan, meal_minutes, runs_on

_LOGGER = logging.getLogger(__name__)

GRACE = timedelta(minutes=5)  # how long a planned meal may take to show up
EARLY = timedelta(minutes=2)  # a feeding this much before the meal still counts
MISSED = "missed_meal"

MESSAGES = {
    "en": {
        "pet_food_jam": "Food is jammed in the feeder.",
        "pet_food_shortages": "Food is running low in the feeder.",
        "pet_food_run_out": "The feeder is out of food.",
        "desiccant_exhausted": "The feeder's desiccant needs replacing.",
        "battery_low": "The feeder's backup battery is low.",
        "device_stuck": "The feeder is stuck.",
        MISSED: "The {time} meal ({portions} portions) was not dispensed. Food may be jammed or empty, or the feeder is offline.",
    },
    "tr": {
        "pet_food_jam": "Mama kabında mama sıkıştı.",
        "pet_food_shortages": "Mama kabında mama azaldı.",
        "pet_food_run_out": "Mama kabında mama bitti.",
        "desiccant_exhausted": "Mama kabının kurutucusu (nem alıcı) bitti.",
        "battery_low": "Mama kabının yedek pili zayıf.",
        "device_stuck": "Mama kabı takıldı.",
        MISSED: "{time} öğünü verilmedi ({portions} porsiyon). Mama sıkışmış ya da bitmiş olabilir, ya da cihaz bağlantısız.",
    },
}


class FeederMonitor:
    def __init__(self, hass: HomeAssistant, dev_id: str, status_getter: Callable[[], dict]) -> None:
        self.hass = hass
        self.dev_id = dev_id
        self._status = status_getter
        self.faults: list[str] = []
        self.missed: dict[str, Any] | None = None
        self.last_feed: datetime | None = None
        self.started = dt_util.now()
        self._checked: set[str] = set()
        self._listeners: list[Callable[[], None]] = []
        self._unsubs: list[Callable[[], None]] = []
        self.feed_entity: str | None = None

    # ------------------------------------------------------------ lifecycle
    @callback
    def start(self, feed_entity: str | None) -> None:
        self.feed_entity = feed_entity
        fault = (self._status() or {}).get("fault")
        if fault is not None:
            self.faults = decode_faults(fault)
        if feed_entity:
            self._unsubs.append(async_track_state_change_event(self.hass, [feed_entity], self._feed_changed))
        self._unsubs.append(async_track_time_change(self.hass, self._tick, second=0))

    @callback
    def stop(self) -> None:
        for unsub in self._unsubs:
            unsub()
        self._unsubs.clear()

    @callback
    def add_listener(self, cb: Callable[[], None]) -> Callable[[], None]:
        self._listeners.append(cb)
        return lambda: self._listeners.remove(cb)

    @callback
    def _changed(self) -> None:
        for cb in list(self._listeners):
            cb()

    # ------------------------------------------------------------ inputs
    @callback
    def handle_report(self, status: list[dict]) -> None:
        """Raw Tuya report items, e.g. {"dpId": 19, "value": 4}. Called in the event loop."""
        for item in status:
            if item.get("dpId") == 19 or item.get("code") == "fault":
                faults = decode_faults(item.get("value"))
                if faults != self.faults:
                    _LOGGER.info("Feeder %s faults: %s", self.dev_id, faults or "none")
                    self.faults = faults
                    self._changed()

    @callback
    def _feed_changed(self, event: Event) -> None:
        new = event.data.get("new_state")
        if new is not None and new.state == "on":
            self.fed(dt_util.now())

    @callback
    def fed(self, when: datetime) -> None:
        self.last_feed = when
        if self.missed is not None:
            self.missed = None
            self._changed()

    # ------------------------------------------------------------ meal check
    @callback
    def _tick(self, now: datetime) -> None:
        self.check(dt_util.as_local(now))

    @callback
    def check(self, now: datetime) -> None:
        plan = decode_plan((self._status() or {}).get("meal_plan"))
        for day_offset in (0, -1):  # a meal at 23:58 is checked after midnight
            day = (now + timedelta(days=day_offset)).replace(hour=0, minute=0, second=0, microsecond=0)
            for meal in plan:
                if not runs_on(meal, day.weekday()):
                    continue
                at = day + timedelta(minutes=meal_minutes(meal))
                due = at + GRACE
                key = f"{at.isoformat()}|{meal['portions']}"
                if not due <= now < due + timedelta(minutes=10) or key in self._checked:
                    continue
                self._checked.add(key)
                if at - EARLY < self.started:
                    continue  # Home Assistant was not watching
                if self.last_feed is not None and self.last_feed >= at - EARLY:
                    continue
                _LOGGER.warning("Feeder %s: planned meal %s was not dispensed", self.dev_id, meal["time"])
                self.missed = {"time": meal["time"], "portions": meal["portions"], "at": at.isoformat()}
                self._changed()
        if len(self._checked) > 200:
            self._checked = set(sorted(self._checked)[-50:])

    # ------------------------------------------------------------ output
    @property
    def problems(self) -> list[str]:
        return [*self.faults, *([MISSED] if self.missed else [])]

    def details(self) -> dict[str, str]:
        lang = "tr" if str(self.hass.config.language or "").lower().startswith("tr") else "en"
        texts = MESSAGES[lang]
        out = {}
        for code in self.problems:
            text = texts.get(code, code)
            if code == MISSED and self.missed:
                text = text.format(**self.missed)
            out[code] = text
        return out
