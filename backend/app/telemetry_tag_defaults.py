"""
Default tag catalogs for the non-Servo-Press telemetry profiles.

Servo Press seeds from ``SERVO_PRESS_REGISTERS`` (Modbus §8.4.2). These catalogs cover
the commissioned demo hardware, so a machine typed PLC or Servo Linear Motor shows its
real parameters instead of an empty screen. Every field stays editable in
Machine Config → Config Tags, and a profile is only seeded while it has no rows.

    generic_plc         AH PLC kit,            Modbus TCP 192.168.1.5:502
    servo_linear_motor  Linear servo motor,    Modbus TCP 192.168.1.7:502

``modbus`` holds the 4xxxx holding-register address quoted by the vendor and ``eip_pn``
the PLC-native name (``D200``, ``%MW0``), matching the two address columns the Servo
Press catalog uses. ``nodered_aliases`` carry both addresses plus the vendor's own
spelling, so a reading arrives mapped whether Node-RED publishes "Tank Level", "D204"
or "40205".
"""
from __future__ import annotations

from typing import Any

# --------------------------------------------------------------------------- AH PLC kit
# Live process values only: nothing here drives the press phase machine, so tag_key
# 'plc_status' is deliberately NOT 'status' — the status badge keeps using PMS status
# rather than misreading a PLC health word as a pressing phase code.
AH_PLC_KIT_TAGS: list[dict[str, Any]] = [
    {
        "key": "pressure",
        "item": "Pressure",
        "modbus": "40201",
        "eip_pn": "D200",
        "group": "live",
        "unit": "kPa",
        "aliases": ["pressure"],
        "note": "Line pressure (AH PLC kit, Modbus TCP 192.168.1.5:502) · SI unit kPa",
    },
    {
        "key": "flow",
        "item": "Flow",
        "modbus": "40203",
        "eip_pn": "D202",
        "group": "live",
        "unit": "L/min",
        "aliases": ["flow"],
        "note": "Volumetric flow rate · SI-derived L/min",
    },
    {
        "key": "tank_level",
        "item": "Tank Level",
        "modbus": "40205",
        "eip_pn": "D204",
        "group": "live",
        "unit": "%",
        "aliases": ["tankLevel", "tank_level", "TankLevel"],
        "note": "Tank level as percent of full capacity",
    },
    {
        "key": "temperature",
        "item": "Temperature",
        "modbus": "40207",
        "eip_pn": "D206",
        "group": "live",
        "unit": "°C",
        "aliases": ["temperature"],
        "note": "Process temperature · Celsius (SI accepted)",
    },
    {
        "key": "digital_input_status",
        "item": "Digital Input Status",
        "modbus": "40209",
        "eip_pn": "D208",
        "group": "live",
        "aliases": ["digitalInput", "digital_input"],
        "note": "Packed DI word (legacy). Prefer coils M309–M316.",
    },
    {
        "key": "digital_output_status",
        "item": "Digital Output Status",
        "modbus": "40211",
        "eip_pn": "D210",
        "group": "live",
        "aliases": ["digitalOutput", "digital_output"],
        "note": "Packed DO word (legacy). Prefer coils M301–M308.",
    },
    {
        "key": "plc_status",
        "item": "PLC Status",
        "modbus": "40213",
        "eip_pn": "D212",
        "group": "live",
        "aliases": ["plcStatus", "plc_status"],
        "note": "PLC health word. 1 = PLC 1 Master, 2 = PLC 2 Master. Not the press Status* phase code.",
    },
]

# ------------------------------------------------------------------ Linear servo motor
# Read registers land in Live Status; the write block (setpoints and commands) is
# grouped as 'result' because the dashboard has exactly two parameter screens.
# Two keys are intentionally shared with the press catalog so the existing panels light
# up: 'live_position' feeds the live tile and trend chart, 'alarm_code' feeds the Alarms
# tab. The rest keep their own keys.
LINEAR_SERVO_MOTOR_TAGS: list[dict[str, Any]] = [
    # ---- write / command block (%MW0 – %MW6)
    {"key": "set_enable", "item": "Enable", "modbus": "40001", "eip_pn": "%MW0",
     "group": "result", "note": "Write · drive enable"},
    {"key": "set_position", "item": "Position", "modbus": "40002", "eip_pn": "%MW1",
     "group": "result", "note": "Write · target position"},
    {"key": "set_speed", "item": "Speed", "modbus": "40003", "eip_pn": "%MW2",
     "group": "result", "note": "Write · target speed"},
    {"key": "set_acc", "item": "ACC", "modbus": "40004", "eip_pn": "%MW3",
     "group": "result", "note": "Write · acceleration"},
    {"key": "set_decc", "item": "Decc", "modbus": "40005", "eip_pn": "%MW4",
     "group": "result", "note": "Write · deceleration"},
    {"key": "home_enable", "item": "Home Enable", "modbus": "40006", "eip_pn": "%MW5",
     "group": "result", "note": "Write · start homing"},
    {"key": "brake_enable", "item": "Break Enable", "modbus": "40007", "eip_pn": "%MW6",
     "group": "result", "note": "Write · brake enable"},
    # ---- read block (%MW20 – %MW32)
    {"key": "power_enable_status", "item": "Power Enable status", "modbus": "40021",
     "eip_pn": "%MW20", "group": "live", "note": "Read · drive powered"},
    {"key": "live_position", "item": "Current Position", "modbus": "40022",
     "eip_pn": "%MW21", "group": "live",
     "note": "Read · feeds the live position tile and trend chart"},
    {"key": "dc_voltage", "item": "DC Voltage", "modbus": "40023", "eip_pn": "%MW22",
     "group": "live", "note": "Read · DC bus voltage"},
    {"key": "home_done", "item": "Home Done", "modbus": "40024", "eip_pn": "%MW23",
     "group": "live", "note": "Read · homing complete"},
    {"key": "forward_limit", "item": "Forward Limit", "modbus": "40025", "eip_pn": "%MW24",
     "group": "live", "aliases": ["Forword Limit"], "note": "Read · forward limit hit"},
    {"key": "reverse_limit", "item": "Reverse Limit", "modbus": "40026", "eip_pn": "%MW25",
     "group": "live", "note": "Read · reverse limit hit"},
    {"key": "alarm_code", "item": "Alarm", "modbus": "40027", "eip_pn": "%MW26",
     "group": "live", "note": "Read · non-zero raises an alarm on the Alarms tab"},
    {"key": "clear_alarm", "item": "Clear Alarm", "modbus": "40028", "eip_pn": "%MW27",
     "group": "live", "note": "Read · alarm reset acknowledge"},
    {"key": "home_cycle_running", "item": "Home Cycle running", "modbus": "40029",
     "eip_pn": "%MW28", "group": "live", "note": "Read · homing in progress"},
    {"key": "positive_power_limit", "item": "Positive power limit", "modbus": "40030",
     "eip_pn": "%MW29", "group": "live", "note": "Read · positive force limit"},
    {"key": "negative_power_limit", "item": "Negative power limit", "modbus": "40031",
     "eip_pn": "%MW30", "group": "live", "note": "Read · negative force limit"},
    {"key": "test", "item": "Test", "modbus": "40032", "eip_pn": "%MW31",
     "group": "live", "note": "Read · vendor test register"},
    {"key": "run_time", "item": "Run time", "modbus": "40033", "eip_pn": "%MW32",
     "group": "live", "note": "Read · accumulated run time"},
]

PROFILE_DEFAULT_TAGS: dict[str, list[dict[str, Any]]] = {
    "generic_plc": AH_PLC_KIT_TAGS,
    "servo_linear_motor": LINEAR_SERVO_MOTOR_TAGS,
}


def default_tags_for_profile(profile_id: str) -> list[dict[str, Any]]:
    """Rows to seed, normalised so the caller can insert them directly.

    Vendor sheets quote INT registers without scaling, so type defaults to a 16-bit
    word with scale 1 and no unit — set those in Config Tags once the physical units
    are known rather than guessing them here.
    """
    rows = PROFILE_DEFAULT_TAGS.get(profile_id) or []
    out: list[dict[str, Any]] = []
    for row in rows:
        item = row["item"]
        aliases = list(row.get("aliases") or [])
        for addr in (row.get("eip_pn"), row.get("modbus")):
            if addr and addr not in aliases:
                aliases.append(addr)
        out.append({
            "key": row["key"],
            "item": item,
            "nodered_name": row.get("nodered_name") or item,
            "aliases": aliases,
            "modbus": row.get("modbus"),
            "eip_pn": row.get("eip_pn"),
            "type": row.get("type") or "W",
            "scale": float(row.get("scale") or 1),
            "unit": row.get("unit") or "",
            "group": row.get("group") or "live",
            "note": row.get("note") or "",
        })
    return out
