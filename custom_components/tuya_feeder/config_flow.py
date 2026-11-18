"""Config flow: nothing to configure, it uses the Tuya integration's session."""

from __future__ import annotations

from homeassistant.config_entries import ConfigFlow

DOMAIN = "tuya_feeder"


class TuyaFeederFlow(ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input=None):
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")
        return self.async_create_entry(title="Tuya Pet Feeder", data={})
