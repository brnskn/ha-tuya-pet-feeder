"""Meal plan encode/decode (no Home Assistant needed)."""

import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location(
    "tuya_feeder_plan", Path(__file__).resolve().parents[1] / "custom_components" / "tuya_feeder" / "plan.py"
)
plan = importlib.util.module_from_spec(spec)
spec.loader.exec_module(plan)


def b64(hexstr: str) -> str:
    import base64

    return base64.b64encode(bytes.fromhex(hexstr)).decode()


class TestPlan(unittest.TestCase):
    def test_tuya_documented_example(self):
        # Thing model: 01 12 32 0c 01 = Sunday, 18:50, 12 portions, enabled
        self.assertEqual(
            plan.decode_plan(b64("0112320c01")),
            [{"days": 1, "time": "18:50", "portions": 12, "enabled": True}],
        )
        self.assertEqual(plan.encode_plan([{"days": 1, "time": "18:50", "portions": 12}]), b64("0112320c01"))

    def test_every_day_plan_roundtrip(self):
        value = b64("7f00000301" "7f09000301" "7f10000301" "7f14000300")
        meals = plan.decode_plan(value)
        self.assertEqual([m["time"] for m in meals], ["00:00", "09:00", "16:00", "20:00"])
        self.assertEqual([m["enabled"] for m in meals], [True, True, True, False])
        self.assertEqual(plan.encode_plan(meals), value)

    def test_defaults_and_validation(self):
        self.assertEqual(
            plan.decode_plan(plan.encode_plan([{"time": "7:30", "portions": 2}])),
            [{"days": 0x7F, "time": "07:30", "portions": 2, "enabled": True}],
        )
        for bad in ([{"time": "25:00", "portions": 1}], [{"time": "10:00", "portions": 0}], [{"time": "10:00", "portions": 21}]):
            with self.assertRaises(ValueError):
                plan.encode_plan(bad)
        with self.assertRaises(ValueError):
            plan.encode_plan([{"time": "08:00", "portions": 1}] * 11)

    def test_garbage_is_empty(self):
        self.assertEqual(plan.decode_plan(""), [])
        self.assertEqual(plan.decode_plan(None), [])
        self.assertEqual(plan.decode_plan("not base64!"), [])


if __name__ == "__main__":
    unittest.main()
