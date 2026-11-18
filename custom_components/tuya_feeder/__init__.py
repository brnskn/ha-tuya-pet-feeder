"""Tuya pet feeder: meal plan and a dashboard card.

The Tuya integration exposes manual feeding and the last portion count, but
not the meal plan (DP "meal_plan"), although it is part of the device's cloud
schema. This integration adds websocket commands to read and write the plan,
sends it through the Tuya integration's own session, and ships the
tuya-pet-feeder-card Lovelace card (loaded automatically).

It also adds a "problem" binary sensor per feeder. It turns on for device
faults (DP 19, which the Tuya integration drops, read from the raw reports)
and for planned meals that were not dispensed.
"""

from __future__ import annotations

from datetime import timedelta
import hashlib
import logging
from pathlib import Path
from typing import Any

from aiohttp import web
import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import HomeAssistantView
from homeassistant.config_entries import ConfigEntry, ConfigEntryState
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import config_validation as cv, device_registry as dr, entity_registry as er
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.helpers.typing import ConfigType

from .const import DOMAIN
from .monitor import FeederMonitor
from .plan import decode_plan, encode_plan

_LOGGER = logging.getLogger(__name__)
VERSION = "1.1.0"
PLATFORMS = [Platform.BINARY_SENSOR]
HOOK_MARK = "_tuya_feeder"
CATEGORY = "cwwsq"
CARD_URL = "/tuya_feeder/tuya-pet-feeder-card.js"
CARD_PATH = Path(__file__).parent / "frontend" / "tuya-pet-feeder-card.js"
CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)
ENTITY_CODES = {
    "manual_feed": "manual_feed",
    "feed_state": "feed_state",
    "feed_report": "feed_report",
    "battery_percentage": "battery",
}


def _managers(hass: HomeAssistant):
    for entry in hass.config_entries.async_entries("tuya"):
        if entry.state is ConfigEntryState.LOADED:
            manager = getattr(getattr(entry, "runtime_data", None), "manager", None)
            if manager is not None:
                yield manager


def _feeders(hass: HomeAssistant):
    for manager in _managers(hass):
        for dev_id, device in manager.device_map.items():
            if getattr(device, "category", None) == CATEGORY:
                yield manager, dev_id, device


def _entities(hass: HomeAssistant, dev_id: str) -> dict[str, str]:
    registry = er.async_get(hass)
    prefix = f"tuya.{dev_id}"
    out: dict[str, str] = {}
    for ent in registry.entities.values():
        if ent.platform == "tuya" and ent.unique_id.startswith(prefix):
            code = ent.unique_id[len(prefix):]
            if code in ENTITY_CODES:
                out[ENTITY_CODES[code]] = ent.entity_id
    problem = registry.async_get_entity_id("binary_sensor", DOMAIN, f"{dev_id}_problem")
    if problem:
        out["problem"] = problem
    return out


@callback
def _ensure_hooks(hass: HomeAssistant, *_: Any) -> None:
    """Wrap each Tuya manager's raw report handler once, to see DPs it drops.

    Other integrations may wrap the same method. Each wrapper copies the
    markers of the one it wraps, so nobody wraps twice.
    """
    monitors: dict[str, FeederMonitor] = hass.data[DOMAIN]["monitors"]
    loop = hass.loop
    for manager in _managers(hass):
        current = manager.__dict__.get("_on_device_report")
        if current is not None and getattr(current, HOOK_MARK, False):
            continue
        original = manager._on_device_report

        def _on_device_report(dev_id: str, status: list, _orig=original):
            monitor = monitors.get(dev_id)
            if monitor is not None:
                try:
                    loop.call_soon_threadsafe(monitor.handle_report, [dict(i) for i in status])
                except RuntimeError:
                    pass
            return _orig(dev_id, status)

        _on_device_report.__dict__.update(getattr(original, "__dict__", None) or {})
        setattr(_on_device_report, HOOK_MARK, True)
        manager._on_device_report = _on_device_report
        _LOGGER.debug("Attached to Tuya reports")


class CardView(HomeAssistantView):
    """Serve the card with "no-cache" so browsers revalidate (ETag) on every load."""

    url = CARD_URL
    name = "tuya_feeder:card"
    requires_auth = False

    async def get(self, request: web.Request) -> web.FileResponse:
        return web.FileResponse(
            CARD_PATH, headers={"Cache-Control": "no-cache", "Content-Type": "text/javascript; charset=utf-8"}
        )


def _card_version() -> str:
    return hashlib.sha1(CARD_PATH.read_bytes()).hexdigest()[:8]


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register the card and the websocket commands."""
    hass.http.register_view(CardView())
    add_extra_js_url(hass, f"{CARD_URL}?v={VERSION}-{await hass.async_add_executor_job(_card_version)}")
    websocket_api.async_register_command(hass, ws_feeders)
    websocket_api.async_register_command(hass, ws_set_plan)
    hass.data.setdefault(DOMAIN, {"monitors": {}})
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    # This integration owns no devices. Drop any it created by mistake (early 1.1 builds).
    devices = dr.async_get(hass)
    for device in dr.async_entries_for_config_entry(devices, entry.entry_id):
        devices.async_remove_device(device.id)
    monitors: dict[str, FeederMonitor] = hass.data[DOMAIN]["monitors"]
    for _, dev_id, device in _feeders(hass):
        monitor = FeederMonitor(hass, dev_id, lambda d=device: getattr(d, "status", {}) or {})
        monitor.start(_entities(hass, dev_id).get("feed_state"))
        monitors[dev_id] = monitor
    _ensure_hooks(hass)
    entry.async_on_unload(async_track_time_interval(hass, lambda now: _ensure_hooks(hass), timedelta(seconds=30)))
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_remove_config_entry_device(hass: HomeAssistant, entry: ConfigEntry, device: dr.DeviceEntry) -> bool:
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    monitors: dict[str, FeederMonitor] = hass.data[DOMAIN]["monitors"]
    for monitor in monitors.values():
        monitor.stop()
    monitors.clear()  # the report wrapper stays in place but does nothing
    return ok


@websocket_api.websocket_command({vol.Required("type"): "tuya_feeder/list"})
@callback
def ws_feeders(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    feeders = []
    for _, dev_id, device in _feeders(hass):
        status = getattr(device, "status", {}) or {}
        monitor = hass.data[DOMAIN]["monitors"].get(dev_id)
        feeders.append(
            {
                "id": dev_id,
                "name": getattr(device, "name", dev_id),
                "online": bool(getattr(device, "online", False)),
                "plan": decode_plan(status.get("meal_plan")),
                "entities": _entities(hass, dev_id),
                "faults": monitor.faults if monitor else [],
                "missed": monitor.missed if monitor else None,
            }
        )
    connection.send_result(msg["id"], feeders)


MEAL = vol.Schema(
    {
        vol.Required("time"): str,
        vol.Required("portions"): vol.All(int, vol.Range(min=1, max=20)),
        vol.Optional("enabled", default=True): bool,
        vol.Optional("days", default=0x7F): vol.All(int, vol.Range(min=0, max=0x7F)),
    }
)


@websocket_api.websocket_command(
    {vol.Required("type"): "tuya_feeder/set_plan", vol.Required("device_id"): str, vol.Required("plan"): [MEAL]}
)
@websocket_api.async_response
async def ws_set_plan(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    target = next(((m, d) for m, dev_id, d in _feeders(hass) if dev_id == msg["device_id"]), None)
    if target is None:
        connection.send_error(msg["id"], "not_found", "feeder not found")
        return
    manager, device = target
    try:
        value = encode_plan(msg["plan"])
    except ValueError as err:
        connection.send_error(msg["id"], "invalid", str(err))
        return
    try:
        await hass.async_add_executor_job(
            manager.send_commands, msg["device_id"], [{"code": "meal_plan", "value": value}]
        )
    except Exception as err:  # noqa: BLE001
        connection.send_error(msg["id"], "failed", str(err))
        return
    device.status["meal_plan"] = value  # the device confirms via MQTT shortly after
    connection.send_result(msg["id"], {"plan": decode_plan(value)})
