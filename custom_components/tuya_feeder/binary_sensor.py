"""One "problem" binary sensor per feeder: faults and missed meals."""

from __future__ import annotations

from typing import Any

from homeassistant.components.binary_sensor import BinarySensorDeviceClass, BinarySensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN
from .monitor import FeederMonitor


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    monitors: dict[str, FeederMonitor] = hass.data[DOMAIN]["monitors"]
    async_add_entities(FeederProblem(m, tuya_device(hass, m.dev_id)) for m in monitors.values())


def tuya_device(hass: HomeAssistant, dev_id: str) -> dr.DeviceEntry | None:
    """The Tuya integration's device for this feeder (identifiers are not shared across integrations)."""
    registry = dr.async_get(hass)
    for entry in hass.config_entries.async_entries("tuya"):
        for device in dr.async_entries_for_config_entry(registry, entry.entry_id):
            if ("tuya", dev_id) in device.identifiers:
                return device
    return None


class FeederProblem(BinarySensorEntity):
    _attr_has_entity_name = True
    _attr_translation_key = "problem"
    _attr_device_class = BinarySensorDeviceClass.PROBLEM
    _attr_should_poll = False

    def __init__(self, monitor: FeederMonitor, device: dr.DeviceEntry | None) -> None:
        self._monitor = monitor
        self._attr_unique_id = f"{monitor.dev_id}_problem"
        self.device_entry = device  # shown on the Tuya device, named after it

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(self._monitor.add_listener(self.async_write_ha_state))

    @property
    def is_on(self) -> bool:
        return bool(self._monitor.problems)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        m = self._monitor
        return {
            "problems": m.problems,
            "details": m.details(),
            "faults": m.faults,
            "missed_meal": m.missed,
            "last_feed": m.last_feed.isoformat() if m.last_feed else None,
        }
