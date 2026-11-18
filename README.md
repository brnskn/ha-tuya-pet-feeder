<p align="center">
  <img src="custom_components/tuya_feeder/brand/icon@2x.png" width="120" alt="Tuya Pet Feeder icon">
</p>

# Tuya Pet Feeder for Home Assistant

Edit the **meal plan** of Tuya pet feeders from Home Assistant, and get a dashboard card with feed now, the next meal, today's feedings and a weekly chart.

> 🇹🇷 **Kısaca:** Tuya mama kabının öğün planını Home Assistant'tan görüp düzenlemenizi sağlar, ve şık bir dashboard kartı ekler: tek dokunuşla mama verme, sonraki öğün, bugün verilen porsiyonlar ve son 7 gün. Kart Türkçe ve İngilizce.

## Why

The official Tuya integration exposes manual feeding (`manual_feed`), the feeding state and the last portion count, but **not the meal plan**. The plan (`meal_plan`) is part of the device's cloud schema, so it can be written through the same Tuya session; it is stored on the feeder itself and keeps working when the feeder is offline.

## Features

- Read and write the meal plan (up to 10 meals: time, portions, on/off, weekdays).
- **Problem sensor** per feeder (`binary_sensor.<feeder>_problem`, device class `problem`), shown on the Tuya device:
  - Device faults: food jam, food low, out of food, desiccant, battery low, stuck (DP 19, read from the raw Tuya reports because the Tuya integration drops it).
  - Missed meals: a planned meal that did not show up as a feeding within 5 minutes. Cleared by the next feeding. Meals planned before Home Assistant started are not checked, so restarts never cause false alarms.
  - Attributes: `problems` (codes), `details` (ready-to-send text in English or Turkish, following the Home Assistant language), `faults`, `missed_meal`, `last_feed`.
- **Lovelace card** `custom:tuya-pet-feeder-card`, loaded automatically (no resource to add):
  - Feed now with a portion stepper.
  - Next meal with a countdown.
  - Today's portions against the plan, shown as a ring.
  - A 24-hour timeline: planned meals, scheduled feedings and manual feedings.
  - The meal plan with an editor (add, remove, change time and portions, toggle).
  - Portions per day for the last 7 days.
  - Warnings for faults, missed meals and a low or empty backup battery.
  - A `compact` mode for overview pages.
  - English and Turkish, following the Home Assistant language.
- Feedings are read from Home Assistant's own history of the Tuya entities, so nothing extra is stored.

## Requirements

- Home Assistant **2026.11** or newer.
- The official **Tuya** integration, with the feeder in it. Tuya category `cwwsq` ("pet feeder"); any feeder with the standard `meal_plan` data point should work.

## Installation

### HACS (custom repository)

1. HACS → three-dot menu → **Custom repositories**.
2. Add `https://github.com/brnskn/ha-tuya-pet-feeder` with category **Integration**.
3. Install **Tuya Pet Feeder** and restart Home Assistant.

### Manual

Copy `custom_components/tuya_feeder` to `<config>/custom_components/tuya_feeder` and restart Home Assistant.

## Setup

```text
Settings -> Devices & services -> Add integration -> Tuya Pet Feeder
```

There is nothing to configure: the integration uses the Tuya integration's session and finds every feeder in it.

## The card

```yaml
type: custom:tuya-pet-feeder-card
```

| Option | Default | Description |
| --- | --- | --- |
| `device_id` | first feeder | Tuya device id, if you have more than one feeder. |
| `title` | device name | Card title. |
| `compact` | `false` | Only status, next meal and feed now. |
| `language` | HA language | Force `en` or `tr`. |

"Feed now" uses the Tuya integration's `number` entity for `manual_feed`, so it works the same as the official app.

## Websocket API

| Command | Description |
| --- | --- |
| `tuya_feeder/list` | Feeders with their decoded meal plan and related entity ids. |
| `tuya_feeder/set_plan` | `device_id`, `plan: [{time: "HH:MM", portions: 1-20, enabled, days}]`. Writes the plan. |

## Meal plan format

The `meal_plan` data point (DP 1) is raw (base64), with 5 bytes per meal:

| Byte | Meaning |
| --- | --- |
| 0 | Weekday mask. Bits are Monday..Sunday from `0x40` to `0x01`; `0x7F` = every day. |
| 1–2 | Hour, minute |
| 3 | Portions (1–20) |
| 4 | Enabled (`01`) or disabled (`00`) |

Example from Tuya's thing model: `01 12 32 0c 01` = Sunday, 18:50, 12 portions, enabled.

## Limitations

- The editor keeps each meal's weekdays but doesn't edit them yet (new meals are every day).
- Fault flags come only from live reports: a fault that started while Home Assistant was down shows up with the device's next report.
- If the feeder is offline at meal time, the meal is reported as missed even though the feeder may have dispensed it from its stored plan.
- Camera features of feeders with a camera are not covered.

## Notifications

Example automation: send each new problem to a phone.

```yaml
triggers:
  - trigger: state
    entity_id: binary_sensor.pet_feeder_problem
    attribute: problems
conditions:
  - "{{ trigger.from_state.state not in ['unavailable', 'unknown'] }}"
  - "{{ trigger.to_state.attributes.problems | reject('in', trigger.from_state.attributes.problems or []) | list | count > 0 }}"
actions:
  - action: notify.mobile_app_my_phone
    data:
      title: Pet feeder
      message: >
        {% set old = trigger.from_state.attributes.problems or [] %}
        {% set d = trigger.to_state.attributes.details %}
        {% for p in trigger.to_state.attributes.problems if p not in old %}{{ d[p] }} {% endfor %}
```

For a low backup battery, use a `numeric_state` trigger on the Tuya battery sensor.

## Development

```bash
python3 -m unittest discover -s tests -v
node --check custom_components/tuya_feeder/frontend/tuya-pet-feeder-card.js
```

Problem sensor logic and the shared Tuya report hook, inside a Home Assistant install:

```bash
docker exec homeassistant python3 /tmp/ha-tuya-pet-feeder/tests/ha_container_check.py /tmp/ha-tuya-pet-feeder
```

## License

MIT
