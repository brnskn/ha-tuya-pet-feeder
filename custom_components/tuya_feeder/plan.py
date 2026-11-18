"""Tuya pet feeder (category cwwsq) meal plan, DP "meal_plan".

Raw, base64. 5 bytes per meal: weekday mask, hour, minute, portions, enabled.
From the device's Tuya thing model: the 7 mask bits are Monday..Sunday from
the most significant used bit, so 0x40 = Monday ... 0x01 = Sunday and 0x7F
means every day. Example: 01 12 32 0c 01 = Sunday, 18:50, 12 portions, on.
The plan is stored on the device (up to 10 meals) and runs while offline.
"""

from __future__ import annotations

import base64
import binascii
import re
from typing import Any

EVERY_DAY = 0x7F
MAX_MEALS = 10
_TIME = re.compile(r"^([01]?\d|2[0-3]):([0-5]\d)$")


def decode_plan(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, str) or not value:
        return []
    try:
        data = base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError):
        return []
    meals = []
    for i in range(0, len(data) - len(data) % 5, 5):
        days, hour, minute, portions, enabled = data[i : i + 5]
        meals.append(
            {"days": days, "time": f"{hour:02d}:{minute:02d}", "portions": portions, "enabled": bool(enabled)}
        )
    return meals


def encode_plan(meals: list[dict[str, Any]]) -> str:
    if len(meals) > MAX_MEALS:
        raise ValueError(f"at most {MAX_MEALS} meals")
    out = bytearray()
    for meal in meals:
        match = _TIME.match(str(meal.get("time", "")).strip())
        if not match:
            raise ValueError(f"invalid time {meal.get('time')!r}")
        portions = int(meal.get("portions", 1))
        if not 1 <= portions <= 20:
            raise ValueError("portions must be 1-20")
        days = int(meal.get("days", EVERY_DAY)) & 0x7F or EVERY_DAY
        out += bytes([days, int(match.group(1)), int(match.group(2)), portions, 1 if meal.get("enabled", True) else 0])
    return base64.b64encode(bytes(out)).decode()
