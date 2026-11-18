"""Check the feeder monitor and the shared Tuya report hook inside a Home Assistant install.

docker exec -i homeassistant python3 /tmp/ha-tuya-pet-feeder/tests/ha_container_check.py /tmp/ha-tuya-pet-feeder
"""

import asyncio
import base64
from datetime import datetime, timedelta
import sys
import tempfile

sys.path.insert(0, sys.argv[1] if len(sys.argv) > 1 else ".")

from homeassistant.core import HomeAssistant  # noqa: E402
from homeassistant.util import dt as dt_util  # noqa: E402

from custom_components.tuya_feeder import monitor as mon  # noqa: E402

FAILED = []


def check(ok, name):
    print(("PASS " if ok else "FAIL ") + name)
    if not ok:
        FAILED.append(name)


async def main():
    hass = HomeAssistant(tempfile.mkdtemp())
    await hass.config.async_set_time_zone("Europe/Istanbul")
    hass.config.language = "tr"
    tz = dt_util.get_default_time_zone()
    status = {"meal_plan": base64.b64encode(bytes.fromhex("7f09000301" "7f10000301" "7f14000300")).decode()}
    m = mon.FeederMonitor(hass, "dev1", lambda: status)
    changes = []
    m.add_listener(lambda: changes.append(list(m.problems)))
    m.started = datetime(2026, 11, 18, 8, 0, tzinfo=tz)

    # 09:00 meal dispensed on time: no problem at 09:05
    m.fed(datetime(2026, 11, 18, 9, 0, 6, tzinfo=tz))
    m.check(datetime(2026, 11, 18, 9, 5, tzinfo=tz))
    check(m.problems == [] and not changes, "meal on time is fine")

    # 16:00 meal never came
    m.check(datetime(2026, 11, 18, 16, 4, tzinfo=tz))
    check(m.missed is None, "nothing before the grace period ends")
    m.check(datetime(2026, 11, 18, 16, 5, tzinfo=tz))
    check(m.missed and m.missed["time"] == "16:00" and m.problems == ["missed_meal"], "missed meal detected")
    check("16:00 öğünü verilmedi (3 porsiyon)" in m.details()["missed_meal"], "Turkish message")
    m.check(datetime(2026, 11, 18, 16, 6, tzinfo=tz))
    check(len(changes) == 1, "checked only once")
    m.fed(datetime(2026, 11, 18, 16, 20, tzinfo=tz))
    check(m.missed is None and changes[-1] == [], "next feeding clears it")

    # disabled 20:00 meal is ignored; meals before startup are ignored
    m.check(datetime(2026, 11, 18, 20, 5, tzinfo=tz))
    check(m.missed is None, "disabled meal ignored")
    m2 = mon.FeederMonitor(hass, "dev2", lambda: status)
    m2.started = datetime(2026, 11, 18, 16, 3, tzinfo=tz)  # HA restarted right after the meal
    m2.check(datetime(2026, 11, 18, 16, 5, tzinfo=tz))
    check(m2.missed is None, "no false alarm after a restart")

    # raw fault report
    m.handle_report([{"dpId": 19, "value": 4, "t": 1}])
    check(m.faults == ["pet_food_run_out"] and m.problems == ["pet_food_run_out"], "fault bitmap from raw report")
    hass.config.language = "en"
    check(m.details()["pet_food_run_out"] == "The feeder is out of food.", "English message")
    m.handle_report([{"dpId": 19, "value": 0, "t": 2}])
    check(m.problems == [], "fault cleared")

    # shared hook: two wrappers on one manager never stack up
    import custom_components.tuya_feeder as feeder

    class Manager:
        def __init__(self):
            self.device_map = {}
            self.calls = 0

        def _on_device_report(self, dev_id, status):
            self.calls += 1

    manager = Manager()
    hass.data[feeder.DOMAIN] = {"monitors": {"dev1": m}}
    feeder._managers = lambda h: iter([manager])

    def other_integration_hook():  # same pattern as kedi_kumu
        current = manager.__dict__.get("_on_device_report")
        if current is not None and getattr(current, "_kedi_kumu", False):
            return
        original = manager._on_device_report

        def wrapper(dev_id, status, _orig=original):
            return _orig(dev_id, status)

        wrapper.__dict__.update(getattr(original, "__dict__", None) or {})
        wrapper._kedi_kumu = True
        manager._on_device_report = wrapper

    for order in range(3):
        other_integration_hook()
        feeder._ensure_hooks(hass)
    first = manager._on_device_report
    for _ in range(3):
        feeder._ensure_hooks(hass)
        other_integration_hook()
    check(manager._on_device_report is first, "hooks do not stack")
    manager._on_device_report("dev1", [{"dpId": 19, "value": 1}])
    await asyncio.sleep(0)
    check(manager.calls == 1 and m.faults == ["pet_food_jam"], "report reaches Tuya once and the monitor")

    await hass.async_stop(force=True)
    print("\nALL PASSED" if not FAILED else f"\n{len(FAILED)} FAILED")
    sys.exit(1 if FAILED else 0)


asyncio.run(main())
