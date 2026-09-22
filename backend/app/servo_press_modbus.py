"""
Servo Press Modbus TCP / RS-485 register catalog (doc §8.4.2) and Node-RED reading mapper.

Rules:
- [Status Data] can be acquired anytime.
- [Pressing Result] should be read when Status* is 4..8 (cycle finished).
- When next cycle starts Status* becomes 3 and previous results clear.
Supported FC: 03 read holding, 06 write single, 16 write multiple.
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Optional


# Catalog keyed by canonical id → Modbus metadata (from manufacturer sheet §8.4.2)
SERVO_PRESS_REGISTERS = {
    # Live status (anytime)
    "live_position": {
        "item": "Live position",
        "modbus": "0x00C8",
        "eip_pn": "D200",
        "type": "DW",
        "scale": 0.001,
        "unit": "mm",
        "group": "live",
        "note": "The real time position",
    },
    "live_force": {
        "item": "Live force",
        "modbus": "0x00CA",
        "eip_pn": "D202",
        "type": "DW",
        "scale": 0.1,
        "unit": "kgf",
        "group": "live",
        "note": "The real time force",
    },
    "live_velocity": {
        "item": "Live Velocity",
        "modbus": "0x00CC",
        "eip_pn": "D204",
        "type": "DW",
        "scale": 0.001,
        "unit": "mm/s",
        "group": "live",
        "note": "The real time velocity",
    },
    "status": {
        "item": "Status*1",
        "modbus": "0x00CE",
        "eip_pn": "D206",
        "type": "W",
        "scale": 1,
        "unit": "",
        "group": "live",
        "note": (
            "0 Not Activated · 1 Activating · 2 Waiting · 3 Pressing · "
            "4 OK · 5–8 NG (force/position limits)"
        ),
    },
    "live_mode": {
        "item": "Live Mode",
        "modbus": "0x00D0",
        "eip_pn": "D208",
        "type": "W",
        "scale": 1,
        "unit": "",
        "group": "live",
        "note": "The current pressing mode",
    },
    "total_steps": {
        "item": "Total Steps",
        "modbus": "0x0110",
        "eip_pn": "D272",
        "type": "W",
        "scale": 1,
        "unit": "",
        "group": "live",
        "note": "Total steps for this recipe",
    },
    "live_step": {
        "item": "Live Step",
        "modbus": "0x00F2",
        "eip_pn": "D242",
        "type": "W",
        "scale": 1,
        "unit": "",
        "group": "live",
        "note": "The current step",
    },
    "recipe_number": {
        "item": "Recipe number",
        "modbus": "0x00F4",
        "eip_pn": "D244",
        "type": "W",
        "scale": 1,
        "unit": "",
        "group": "live",
        "note": "The current chosen recipe",
    },
    # Pressing result (when status 4–8)
    "total_amount": {
        "item": "Total amount",
        "modbus": "0x00DE",
        "eip_pn": "D222",
        "type": "DW",
        "scale": 1,
        "unit": "pcs",
        "group": "result",
        "note": "The production amount",
    },
    "pass_amount": {
        "item": "Pass amount",
        "modbus": "0x00E0",
        "eip_pn": "D224",
        "type": "DW",
        "scale": 1,
        "unit": "pcs",
        "group": "result",
        "note": "The pass amount of production",
    },
    "ng_amount": {
        "item": "NG amount",
        "modbus": "0x00E2",
        "eip_pn": "D226",
        "type": "DW",
        "scale": 1,
        "unit": "pcs",
        "group": "result",
        "note": "The NG amount of production",
    },
    "standby_time": {
        "item": "Standby time",
        "modbus": "0x00D6",
        "eip_pn": "D214",
        "type": "DW",
        "scale": 0.1,
        "unit": "s",
        "group": "result",
        "note": "Waiting time at the standby position",
    },
    "pressing_time": {
        "item": "Pressing time",
        "modbus": "0x00D8",
        "eip_pn": "D216",
        "type": "DW",
        "scale": 0.1,
        "unit": "s",
        "group": "result",
        "note": "Holding time at the pressed point",
    },
    "production_time": {
        "item": "Production time",
        "modbus": "0x00DA",
        "eip_pn": "D218",
        "type": "DW",
        "scale": 0.01,
        "unit": "s",
        "group": "result",
        "note": "Cycle time of a single process",
    },
    "alarm_code": {
        "item": "Alarm Code",
        "modbus": "0x0106",
        "eip_pn": "D262",
        "type": "W",
        "scale": 1,
        "unit": "",
        "group": "result",
        "note": "Refer to alarm table §9.1",
    },
    "pressing_result": {
        "item": "Pressing result",
        "modbus": "0x0107",
        "eip_pn": "D263",
        "type": "W",
        "scale": 1,
        "unit": "",
        "group": "result",
        "note": "OK/NG latch; Status* 4–8 also encodes the outcome",
    },
    "pressed_position": {
        "item": "Pressed Pos",
        "modbus": "0x0258",
        "eip_pn": "D600",
        "type": "DW",
        "scale": 0.001,
        "unit": "mm",
        "group": "result",
        "note": "Last pressed position (HMI Pressed Result)",
    },
    "pressed_force": {
        "item": "Pressed Force",
        "modbus": "0x025C",
        "eip_pn": "D604",
        "type": "DW",
        "scale": 0.1,
        "unit": "kgf",
        "group": "result",
        "note": "Last pressed force (HMI Pressed Result)",
    },
    "pressed_position_step1": {
        "item": "Pressed position (Step 1)",
        "modbus": "0x0258",
        "eip_pn": "D600",
        "type": "DW",
        "scale": 0.001,
        "unit": "mm",
        "group": "result",
        "note": "Pressed position of step 1 process",
    },
    "pressed_position_step2": {
        "item": "Pressed position (Step 2)",
        "modbus": "0x025A",
        "eip_pn": "D602",
        "type": "DW",
        "scale": 0.001,
        "unit": "mm",
        "group": "result",
        "note": "Pressed position of step 2 process",
    },
    "pressed_position_step3": {
        "item": "Pressed position (Step 3)",
        "modbus": "0x025C",
        "eip_pn": "D604",
        "type": "DW",
        "scale": 0.001,
        "unit": "mm",
        "group": "result",
        "note": "Pressed position of step 3 process",
    },
    "pressed_position_step4": {
        "item": "Pressed position (Step 4)",
        "modbus": "0x025E",
        "eip_pn": "D606",
        "type": "DW",
        "scale": 0.001,
        "unit": "mm",
        "group": "result",
        "note": "Pressed position of step 4 process",
    },
    "pressed_position_step5": {
        "item": "Pressed position (Step 5)",
        "modbus": "0x0260",
        "eip_pn": "D608",
        "type": "DW",
        "scale": 0.001,
        "unit": "mm",
        "group": "result",
        "note": "Pressed position of step 5 process",
    },
}

# Aliases Node-RED / Edge may send as reading.name (case-insensitive)
_NAME_ALIASES = {
    "live position": "live_position",
    "live_position": "live_position",
    "position": "live_position",
    "live force": "live_force",
    "live_force": "live_force",
    "force": "live_force",
    "load": "live_force",
    "live velocity": "live_velocity",
    "live_velocity": "live_velocity",
    "velocity": "live_velocity",
    "status": "status",
    "status*1": "status",
    "status*": "status",
    "live mode": "live_mode",
    "live_mode": "live_mode",
    "mode": "live_mode",
    "total steps": "total_steps",
    "total_steps": "total_steps",
    "live step": "live_step",
    "live_step": "live_step",
    "recipe number": "recipe_number",
    "recipe_number": "recipe_number",
    "recipe": "recipe_number",
    "total amount": "total_amount",
    "total_amount": "total_amount",
    "total count": "total_amount",
    "pass amount": "pass_amount",
    "pass_amount": "pass_amount",
    "good count": "pass_amount",
    "good amount": "pass_amount",
    "ng amount": "ng_amount",
    "ng_amount": "ng_amount",
    "reject count": "ng_amount",
    "reject amount": "ng_amount",
    "standby time": "standby_time",
    "standby_time": "standby_time",
    "pressing time": "pressing_time",
    "pressing_time": "pressing_time",
    "production time": "production_time",
    "production_time": "production_time",
    "cycle time": "production_time",
    "alarm code": "alarm_code",
    "alarm_code": "alarm_code",
    "alarm": "alarm_code",
    "pressing result": "pressing_result",
    "pressing_result": "pressing_result",
    "result": "pressing_result",
    "pressed position (step 1)": "pressed_position_step1",
    "pressed position step 1": "pressed_position_step1",
    "pressed_position_step1": "pressed_position_step1",
    "pressed pos1": "pressed_position_step1",
    "pressed_pos1": "pressed_position_step1",
    "pressed pos": "pressed_position",
    "pressed_pos": "pressed_position",
    "pressed force": "pressed_force",
    "pressed_force": "pressed_force",
    "pressed force1": "pressed_force",
    "pressed_force1": "pressed_force",
    "pressed position (step 2)": "pressed_position_step2",
    "pressed position step 2": "pressed_position_step2",
    "pressed_position_step2": "pressed_position_step2",
    "pressed pos2": "pressed_position_step2",
    "pressed_pos2": "pressed_position_step2",
    "pressed position (step 3)": "pressed_position_step3",
    "pressed position step 3": "pressed_position_step3",
    "pressed_position_step3": "pressed_position_step3",
    "pressed pos3": "pressed_position_step3",
    "pressed_pos3": "pressed_position_step3",
    "pressed position (step 4)": "pressed_position_step4",
    "pressed position step 4": "pressed_position_step4",
    "pressed_position_step4": "pressed_position_step4",
    "pressed_position_step_4": "pressed_position_step4",
    "pressed pos4": "pressed_position_step4",
    "pressed_pos4": "pressed_position_step4",
    "pressed position (step 5)": "pressed_position_step5",
    "pressed position step 5": "pressed_position_step5",
    "pressed_position_step5": "pressed_position_step5",
    "pressed_position_step_5": "pressed_position_step5",
    "pressed pos5": "pressed_position_step5",
    "pressed_pos5": "pressed_position_step5",
    "device type": "device_type",
    "device_type": "device_type",
    "devicetype": "device_type",
}
# NOTE: PLC / Linear Motor / SPM Screw Driver aliases live in
# ``app.telemetry_modules.*`` and are applied only for that profile.
# Do not add TorqueValue / Pressure / etc. here — it would clash across dashboards.


def _strip_type_suffix(name: str) -> str:
    """'status:Int16' / 'pressure;Int16' / 'Pump;Bool' → base name."""
    s = (name or "").strip()
    # EdgeX / SIE uses ';Type'; Servo Press Node-RED often uses ':Type'
    for sep in (";", ":"):
        if sep in s:
            s = s.split(sep, 1)[0].strip()
            break
    return s


def normalize_reading_key(
    name: str,
    *,
    registers: Optional[dict] = None,
    aliases: Optional[dict] = None,
) -> Optional[str]:
    regs = registers if registers is not None else SERVO_PRESS_REGISTERS
    alias_map = aliases if aliases is not None else _NAME_ALIASES
    base = _strip_type_suffix(name).lower()
    base = re.sub(r"\s+", " ", base).strip()
    if base in alias_map:
        return alias_map[base]
    compact = base.replace(" ", "_").replace("-", "_")
    if compact in regs:
        return compact
    if compact in alias_map:
        return alias_map[compact]
    return None


def _to_number(raw: Any) -> Optional[float]:
    if raw is None or raw == "":
        return None
    if isinstance(raw, bool):
        return 1.0 if raw else 0.0
    if isinstance(raw, (int, float)):
        return float(raw)
    s = str(raw).strip()
    if not s:
        return None
    low = s.lower()
    # EdgeX / Go prints nil Bool as "<nil>" — treat as off (0)
    if low in {"null", "none", "nan", "<nil>", "nil"}:
        return 0.0
    if low in {"true", "on", "yes"}:
        return 1.0
    if low in {"false", "off", "no"}:
        return 0.0
    try:
        return float(s)
    except ValueError:
        return None


def merge_readings_by_name(prev: list, incoming: list) -> list:
    """
    SIE/EdgeX often publishes analogs, DO coils, and DI coils as separate messages.
    Merge by stripped tag name so a DO-only push does not wipe pressure/flow.
    """
    by_key: dict[str, dict] = {}
    order: list[str] = []
    for row in list(prev or []) + list(incoming or []):
        if not isinstance(row, dict):
            continue
        name = row.get("name")
        if name is None or name == "":
            continue
        key = _strip_type_suffix(str(name)).lower()
        if not key or key == "device_type":
            # Keep device_type out of the sticky map — it is metadata, not a process tag
            continue
        if key not in by_key:
            order.append(key)
        by_key[key] = row
    return [by_key[k] for k in order]

# AH PLC coil map (Node-RED M301–M316) → Machine Status indicator panels
_PLC_DIGITAL_OUTPUTS = (
    ("do_pump", "Pump", ("pump",), "pump"),
    ("do_blower", "Blower", ("blower",), "blower"),
    ("do_chiller", "Chiller", ("chiller",), "chiller"),
    ("do_motor", "Motor", ("motor",), "motor"),
    ("do_boiler", "Boiler", ("boiler",), "boiler"),
    ("do_furnace", "Furnace", ("furnace",), "furnace"),
    ("do_conveyor", "Conveyor", ("conveyor",), "conveyor"),
    ("do_generators", "Generators", ("electric_generators", "generators", "electric generators"), "generator"),
)
_PLC_DIGITAL_INPUTS = tuple(
    (f"di_{i}", f"D I/O {i}", (f"digital_input{i}", f"digital_input_{i}", f"d_i/o_{i}", f"di_{i}"))
    for i in range(1, 9)
)


def _reading_name_key(name: Any) -> str:
    base = _strip_type_suffix(str(name or "")).lower()
    return re.sub(r"[\s\-]+", "_", base).strip("_")


def _bool_on(value: Any) -> Optional[bool]:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return value
    num = _to_number(value)
    if num is None:
        return None
    return bool(num)


def build_plc_digital_io(readings: list, scaled: dict, raw_by_key: dict) -> dict:
    """Build Digital Input / Digital Output indicator panels for the AH PLC kit."""
    by_name: dict[str, Any] = {}
    for row in readings or []:
        if not isinstance(row, dict):
            continue
        key = _reading_name_key(row.get("name"))
        if key:
            by_name[key] = row.get("value")

    def resolve(aliases: tuple[str, ...], scaled_key: str):
        if scaled_key in scaled and scaled.get(scaled_key) is not None:
            return _bool_on(scaled.get(scaled_key))
        if scaled_key in raw_by_key and raw_by_key.get(scaled_key) is not None:
            return _bool_on(raw_by_key.get(scaled_key))
        for alias in aliases:
            if alias in by_name:
                return _bool_on(by_name[alias])
        return None

    outputs = []
    for key, label, aliases, icon in _PLC_DIGITAL_OUTPUTS:
        on = resolve(aliases, key)
        outputs.append({"key": key, "label": label, "icon": icon, "on": on})
        if on is not None:
            scaled[key] = 1.0 if on else 0.0

    inputs = []
    for key, label, aliases in _PLC_DIGITAL_INPUTS:
        on = resolve(aliases, key)
        # Also unpack packed digital_input_status word when individual coils are absent
        if on is None and scaled.get("digital_input_status") is not None:
            try:
                bit = int(float(scaled["digital_input_status"]))
                idx = int(key.split("_")[1]) - 1
                on = bool((bit >> idx) & 1)
            except (TypeError, ValueError, IndexError):
                on = None
        inputs.append({"key": key, "label": label, "on": on})
        if on is not None:
            scaled[key] = 1.0 if on else 0.0

    # Unpack packed DO word into outputs when coils were not posted individually
    if scaled.get("digital_output_status") is not None and all(o["on"] is None for o in outputs):
        try:
            word = int(float(scaled["digital_output_status"]))
            for idx, out in enumerate(outputs):
                out["on"] = bool((word >> idx) & 1)
                scaled[out["key"]] = 1.0 if out["on"] else 0.0
        except (TypeError, ValueError):
            pass

    return {"inputs": inputs, "outputs": outputs}

def decode_status(code: Optional[float]) -> dict:
    """
    Decode Servo Press Status* (0x00CE / Edge Status;Int32):

      0 : Not Activated
      1 : Activating
      2 : Activation Complete and Waiting
      3 : Pressing
      4 : Pressing - OK
      5 : NG , force is greater than Max limit
      6 : NG , force is less than Min Limit
      7 : NG , position is greater than the maximum limit
      8 : NG , Position is less than the minimum limit
    """
    table = {
        0: {
            "phase_label": "Not Activated",
            "label": "Not Activated",
            "phase": "idle",
            "result_ready": False,
            "ok": None,
            "prompt": "Not activated",
            "note": "Machine not activated.",
        },
        1: {
            "phase_label": "Activating",
            "label": "Activating",
            "phase": "idle",
            "result_ready": False,
            "ok": None,
            "prompt": "Activating…",
            "note": "Activation in progress.",
        },
        2: {
            "phase_label": "Activation Complete and Waiting",
            "label": "Activation Complete and Waiting",
            "phase": "idle",
            "result_ready": False,
            "ok": None,
            "prompt": "Ready, please press the button",
            "note": "Activation complete — waiting for press.",
        },
        3: {
            "phase_label": "Pressing",
            "label": "Pressing",
            "phase": "pressing",
            "result_ready": False,
            "ok": None,
            "prompt": "Pressing…",
            "note": "Cycle in progress. Previous Pressing Result values may clear.",
        },
        4: {
            "phase_label": "Pressing - OK",
            "label": "Pressing - OK",
            "phase": "result",
            "result_ready": True,
            "ok": True,
            "prompt": "Pressing - OK",
            "note": "Cycle finished OK. Pressing Result registers are valid.",
        },
        5: {
            "phase_label": "NG, force > Max limit",
            "label": "NG, force is greater than Max limit",
            "phase": "result",
            "result_ready": True,
            "ok": False,
            "prompt": "NG — force greater than Max limit",
            "note": "NG: force exceeded Max Force limit.",
        },
        6: {
            "phase_label": "NG, force < Min limit",
            "label": "NG, force is less than Min Limit",
            "phase": "result",
            "result_ready": True,
            "ok": False,
            "prompt": "NG — force less than Min limit",
            "note": "NG: force below Min Force limit.",
        },
        7: {
            "phase_label": "NG, position > Max limit",
            "label": "NG, position is greater than the maximum limit",
            "phase": "result",
            "result_ready": True,
            "ok": False,
            "prompt": "NG — position greater than maximum limit",
            "note": "NG: pressed position above maximum limit.",
        },
        8: {
            "phase_label": "NG, position < Min limit",
            "label": "NG, Position is less than the minimum limit",
            "phase": "result",
            "result_ready": True,
            "ok": False,
            "prompt": "NG — position less than minimum limit",
            "note": "NG: pressed position below minimum limit.",
        },
    }
    if code is None:
        return {
            "code": None,
            "phase_label": "—",
            "label": "—",
            "display": "—",
            "phase": "unknown",
            "result_ready": False,
            "ok": None,
            "prompt": None,
            "note": None,
        }
    c = int(code)
    row = table.get(c)
    if not row:
        return {
            "code": c,
            "phase_label": f"Status {c}",
            "label": f"Status {c}",
            "display": f"Status | code {c}",
            "phase": "other",
            "result_ready": False,
            "ok": None,
            "prompt": f"Status {c}",
            "note": None,
        }
    return {
        "code": c,
        "phase_label": row["phase_label"],
        "label": row["label"],
        "display": f"{row['phase_label']} | code {c}",
        "phase": row["phase"],
        "result_ready": row["result_ready"],
        "ok": row["ok"],
        "prompt": row["prompt"],
        "note": row["note"],
    }


def decode_pressing_result(code: Optional[float]) -> dict:
    """
    Modbus Pressing result (0x0107) — and some Edge tags that reuse Status* codes:
      0     → cleared / not latched
      1     → OK
      2     → NG
      4–8   → same OK/NG meanings as Status* (never show the raw digit as Result)
    Alarm Code is a separate register (004 = Emergency Stop) and must not appear here.
    """
    if code is None:
        return {"code": None, "label": "—", "ok": None, "reason": None}
    c = int(code)
    if c == 0:
        return {"code": 0, "label": "—", "ok": None, "reason": None}
    if c == 1:
        return {"code": 1, "label": "OK", "ok": True, "reason": None}
    if c == 2:
        return {"code": 2, "label": "NG", "ok": False, "reason": None}
    # Edge / HMI sometimes latch Status* 4–8 into the Pressing result word
    from_status = decode_result_from_status(c)
    if from_status:
        return from_status
    # Unknown codes: keep numeric code internally, never paint it as the Result label
    return {"code": c, "label": "—", "ok": None, "reason": None}


def decode_result_from_status(status_code: Optional[float]) -> Optional[dict]:
    """Map Status* 4–8 onto an OK/NG pressing result for the HMI."""
    if status_code is None:
        return None
    c = int(status_code)
    if c == 4:
        return {"code": 4, "label": "OK", "ok": True, "reason": "Pressing - OK"}
    if c == 5:
        return {
            "code": 5,
            "label": "NG",
            "ok": False,
            "reason": "Force greater than Max limit",
        }
    if c == 6:
        return {
            "code": 6,
            "label": "NG",
            "ok": False,
            "reason": "Force less than Min limit",
        }
    if c == 7:
        return {
            "code": 7,
            "label": "NG",
            "ok": False,
            "reason": "Position greater than maximum limit",
        }
    if c == 8:
        return {
            "code": 8,
            "label": "NG",
            "ok": False,
            "reason": "Position less than minimum limit",
        }
    return None


# Press keys that Machine Status renders with decoded phase / result labels
_PRESS_IO_KEYS = ("status", "live_mode", "live_step", "total_steps", "pressing_result", "alarm_code")
# Press keys that Current Values renders as Position / Force / Velocity / Cycle Time
_PRESS_TILE_KEYS = ("live_position", "live_force", "live_velocity", "production_time")
_STATUS_WORD_HINTS = ("status", "alarm", "state", "fault", "limit", "done", "enable", "ready", "mode")
_TILE_ACCENTS = ("#3b82f6", "#f59e0b", "#22c55e", "#8b5cf6")


def _is_status_like(key: str, meta: dict) -> bool:
    """A discrete condition word (PLC Status, Home Done, Alarm) rather than a measurement."""
    text = f"{key} {meta.get('item') or ''}".lower()
    return any(hint in text for hint in _STATUS_WORD_HINTS)


def _display_value(value: Any, unit: Optional[str] = None) -> Optional[str]:
    if value is None:
        return None
    text = f"{value:g}" if isinstance(value, float) else str(value)
    return f"{text} {unit}" if unit else text


def map_node_red_readings(
    readings: list,
    *,
    registers: Optional[dict] = None,
    aliases: Optional[dict] = None,
) -> dict:
    """
    Convert Node-RED readings[{name,value}] into scaled canonical fields + UI blocks.
    Optional registers/aliases override the built-in §8.4.2 catalog (DB-backed tags).

    Callers must pass profile-scoped aliases (see ``telemetry_modules.aliases_for_profile``).
    When aliases is None, Servo Press built-ins are used for legacy callers only.
    """
    regs = registers if registers is not None else SERVO_PRESS_REGISTERS
    # Do NOT merge every family's aliases — that caused Press/PLC/SPM dashboards to clash.
    alias_map = dict(aliases) if aliases is not None else dict(_NAME_ALIASES)
    raw_by_key: dict[str, Any] = {}
    scaled: dict[str, Any] = {}
    unknown: list[dict] = []

    for row in readings or []:
        if not isinstance(row, dict):
            continue
        name = row.get("name")
        value = row.get("value")
        key = normalize_reading_key(
            str(name) if name is not None else "",
            registers=regs,
            aliases=alias_map,
        )
        if not key:
            unknown.append({"name": name, "value": value})
            continue
        if key == "device_type":
            scaled["device_type"] = str(value) if value is not None else None
            raw_by_key[key] = value
            continue
        meta = regs.get(key)
        # DB tag catalogs may omit newer Edge names (Pressed Pos / Force) — keep built-in scale
        if meta is None and key in SERVO_PRESS_REGISTERS:
            meta = SERVO_PRESS_REGISTERS[key]
        raw_by_key[key] = value
        num = _to_number(value)
        if meta and num is not None:
            scaled[key] = round(num * float(meta.get("scale") or 1), 6)
        else:
            scaled[key] = num if num is not None else value

    digital_io = build_plc_digital_io(readings or [], scaled, raw_by_key)

    status_info = decode_status(_to_number(raw_by_key.get("status")))
    result_info = decode_pressing_result(_to_number(raw_by_key.get("pressing_result")))
    # Status* 4–8 encode OK/NG on this press — prefer that when the result register is cleared
    from_status = decode_result_from_status(status_info.get("code"))
    if from_status and (result_info.get("code") in (None, 0) or status_info.get("result_ready")):
        result_info = from_status
    alarm = scaled.get("alarm_code")
    alarm_active = alarm is not None and float(alarm) != 0

    # Prefer Modbus production counters; UI falls back to OEE KPI if absent
    production = {
        "total": scaled.get("total_amount"),
        "good": scaled.get("pass_amount"),
        "reject": scaled.get("ng_amount"),
    }

    current = {
        "position_mm": scaled.get("live_position"),
        "force_kgf": scaled.get("live_force"),
        "velocity_mm_s": scaled.get("live_velocity"),
        "cycle_time_sec": scaled.get("production_time"),
    }

    # Current Values keeps the press tiles when the catalog has motion registers; other
    # catalogs (AH PLC / SPM) name their own tiles from the tag list. Family-specific
    # fallbacks (e.g. Screw Driver) run in telemetry_modules.enrich_for_profile.
    current_tiles: list[dict] = []
    if not any(k in regs for k in _PRESS_TILE_KEYS):
        candidates = [
            (key, meta) for key, meta in regs.items()
            if (meta.get("group") or "other") != "result"
            and key not in ("digital_input_status", "digital_output_status", "plc_status", "device_type")
            and not str(key).startswith(("di_", "do_"))
        ]
        # Measurements read better as tiles than condition words, so they come first
        candidates.sort(key=lambda kv: _is_status_like(*kv))
        for (key, meta), accent in zip(candidates[:4], _TILE_ACCENTS):
            current_tiles.append({
                "key": key,
                "label": meta.get("item") or key.replace("_", " "),
                "value": _display_value(scaled.get(key)),
                "unit": meta.get("unit") or "",
                "accent": accent,
                "note": meta.get("note"),
            })

    # Machine Status rows are built from the catalog: a PLC has no Live Step or Pressing
    # Result, so those rows are skipped instead of shown as blanks. Packed DI/DO words
    # are omitted when the digital_io indicator panels are used instead.
    io_status: list[dict] = []
    if "status" in regs:
        status_ok = status_info.get("ok")
        if status_ok is None:
            status_ok = status_info["phase"] in ("pressing", "result", "idle")
        io_status.append({
            "label": (regs["status"].get("item") or "Press Status"),
            "value": status_info.get("display") or status_info.get("label"),
            "phase_label": status_info.get("phase_label"),
            "code": status_info.get("code"),
            "ok": status_ok,
            "note": status_info.get("note"),
            "prompt": status_info.get("prompt"),
        })
    if "live_mode" in regs:
        io_status.append({
            "label": (regs["live_mode"].get("item") or "Live Mode"),
            "value": scaled.get("live_mode") if scaled.get("live_mode") is not None else None,
            "ok": scaled.get("live_mode") is not None,
        })
    if "live_step" in regs:
        io_status.append({
            "label": (regs["live_step"].get("item") or "Live Step"),
            "value": (
                f"{scaled.get('live_step')}/{scaled.get('total_steps')}"
                if scaled.get("live_step") is not None
                else None
            ),
            "ok": scaled.get("live_step") is not None,
        })
    if "pressing_result" in regs:
        result_label = result_info.get("label") or "—"
        if result_info.get("reason") and result_info.get("ok") is False:
            result_label = f"{result_label} · {result_info['reason']}"
        io_status.append({
            "label": (regs["pressing_result"].get("item") or "Pressing Result"),
            "value": result_label,
            "ok": result_info.get("ok"),
        })
    if "alarm_code" in regs:
        alarm_info = servo_press_alarm_info(alarm if alarm_active else 0)
        if alarm_active:
            alarm_value = f"{alarm_info.get('code_label')} · {alarm_info.get('message')}"
        elif alarm is not None:
            alarm_value = "No Alarm"
        else:
            alarm_value = None
        io_status.append({
            "label": (regs["alarm_code"].get("item") or "Alarm"),
            "value": alarm_value,
            "ok": False if alarm_active else (True if alarm is not None else None),
            "code": alarm_info.get("code") if alarm_active else 0,
            "code_label": alarm_info.get("code_label") if alarm_active else "000",
            "message": alarm_info.get("message") if alarm_active else "No Alarm",
            "handling": alarm_info.get("handling") if alarm_active else None,
        })
    for key, meta in regs.items():
        if len(io_status) >= 5:
            break
        # PLC Status + packed DI/DO words stay off Machine Status (digital_io panels + Live Tags).
        if (
            key in _PRESS_IO_KEYS
            or key in ("plc_status", "digital_input_status", "digital_output_status")
            or str(key).startswith(("di_", "do_"))
            or (meta.get("group") or "other") == "result"
        ):
            continue
        if not _is_status_like(key, meta):
            continue
        io_status.append({
            "label": meta.get("item") or key.replace("_", " "),
            "value": _display_value(scaled.get(key), meta.get("unit")),
            "ok": None,
            "note": meta.get("note"),
        })

    param_rows = []
    for key, meta in regs.items():
        val = scaled.get(key)
        unit = meta.get("unit") or ""
        if val is None:
            display = "—"
        elif unit:
            if isinstance(val, float):
                display = f"{val:g} {unit}"
            else:
                display = f"{val} {unit}"
        else:
            if key == "status":
                display = status_info.get("display") or status_info.get("label")
            elif key == "pressing_result":
                display = result_info["label"]
            elif key == "alarm_code":
                ainfo = servo_press_alarm_info(_to_number(raw_by_key.get("alarm_code")))
                if ainfo.get("code") and ainfo.get("code") != 0:
                    display = f"{ainfo.get('code_label')} · {ainfo.get('message')}"
                elif ainfo.get("code") == 0:
                    display = "No Alarm"
                else:
                    display = f"{val:g}" if isinstance(val, float) else str(val)
            else:
                display = f"{val:g}" if isinstance(val, float) else str(val)
        param_rows.append({
            "key": key,
            "label": meta.get("item") or key,
            "value": display,
            "modbus": meta.get("modbus"),
            "eip_pn": meta.get("eip_pn"),
            "type": meta.get("type"),
            "unit": unit or "—",
            "group": meta.get("group") or "other",
            "note": meta.get("note"),
            "raw": raw_by_key.get(key),
            "scaled": val,
        })

    # Append unknown Node-RED tags so future points still surface in Parameters
    for u in unknown:
        param_rows.append({
            "key": None,
            "label": _strip_type_suffix(str(u.get("name") or "Unknown")),
            "value": "—" if u.get("value") is None else str(u.get("value")),
            "modbus": None,
            "eip_pn": None,
            "type": None,
            "unit": None,
            "group": "other",
            "note": "Unmapped Node-RED reading — add a Telemetry Tag in Machine Config",
            "raw": u.get("value"),
            "scaled": None,
        })

    return {
        "scaled": scaled,
        "raw": raw_by_key,
        "status": status_info,
        "pressing_result": result_info,
        "production": production,
        "current": current,
        "current_tiles": current_tiles,
        "io_status": io_status,
        "digital_io": digital_io,
        "param_rows": param_rows,
        "registers": regs,
        "result_ready": bool(status_info.get("result_ready")),
    }


def apply_sticky_production(mapped: dict, prev_mapped: Optional[dict] = None, runtime: Optional[dict] = None) -> dict:
    """
    Modbus clears Pressing Result (Total/Pass/NG) when Status* returns to 3 (Pressing).
    Keep last known counters for UI Production tiles + OEE/QR until Result ready (4–8).
    """
    if not isinstance(mapped, dict):
        return mapped
    phase = ((mapped.get("status") or {}).get("phase") or "").lower()
    result_ready = bool((mapped.get("status") or {}).get("result_ready") or mapped.get("result_ready"))
    prod = dict(mapped.get("production") or {})
    prev_prod = ((prev_mapped or {}).get("production") or {}) if isinstance(prev_mapped, dict) else {}
    rt = runtime or {}

    def _num(v):
        return _to_number(v)

    def pick(key: str, rt_key: str):
        cur = _num(prod.get(key))
        prev = _num(prev_prod.get(key))
        held = _num(rt.get(rt_key))
        # Fresh Result-ready values win
        if result_ready and cur is not None and cur > 0:
            return cur
        # During pressing (or cleared zeros), prefer previous / runtime hold
        if phase == "pressing" or (cur is not None and cur == 0 and not result_ready):
            for cand in (prev, held):
                if cand is not None and cand > 0:
                    return cand
        if cur is not None:
            return cur
        for cand in (prev, held):
            if cand is not None:
                return cand
        return None

    sticky = {
        "total": pick("total", "last_total"),
        "good": pick("good", "last_good"),
        "reject": pick("reject", "last_reject"),
    }
    mapped["production"] = sticky

    scaled = dict(mapped.get("scaled") or {})
    key_map = {"total": "total_amount", "good": "pass_amount", "reject": "ng_amount"}
    for prod_key, scaled_key in key_map.items():
        val = sticky.get(prod_key)
        if val is not None:
            scaled[scaled_key] = val
    mapped["scaled"] = scaled

    # Hold last cycle time while production_time register is cleared during Pressing
    current = dict(mapped.get("current") or {})
    ct = _num(current.get("cycle_time_sec"))
    prev_ct = _num(((prev_mapped or {}).get("current") or {}).get("cycle_time_sec")) if isinstance(prev_mapped, dict) else None
    held_ct = _num(rt.get("last_cycle_time_sec"))
    if phase == "pressing" and (ct is None or ct == 0):
        for cand in (prev_ct, held_ct):
            if cand is not None and cand > 0:
                current["cycle_time_sec"] = cand
                break
    mapped["current"] = current

    # Hold last Pressed Result only when this snapshot omitted the tag entirely.
    # If Edge sent Pressed Pos / Force (even 0), always use the live scaled value.
    prev_scaled = ((prev_mapped or {}).get("scaled") or {}) if isinstance(prev_mapped, dict) else {}
    raw_now = mapped.get("raw") if isinstance(mapped.get("raw"), dict) else {}
    result_info = dict(mapped.get("pressing_result") or {})
    prev_result = ((prev_mapped or {}).get("pressing_result") or {}) if isinstance(prev_mapped, dict) else {}
    def _result_latched(info: dict) -> bool:
        """True when info is a real OK/NG latch (not cleared / not a raw digit)."""
        if not isinstance(info, dict):
            return False
        if info.get("ok") is not None:
            return True
        label = str(info.get("label") or "").strip().upper()
        return label in ("OK", "NG")

    if phase == "pressing":
        for clear_key in ("standby_time", "pressing_time", "production_time"):
            cur_v = _num(scaled.get(clear_key))
            if cur_v is None or cur_v == 0:
                scaled[clear_key] = 0
        if result_info.get("code") in (None, 0) or result_info.get("ok") is None:
            mapped["pressing_result"] = {"code": 0, "label": "-", "ok": None, "reason": None}
            result_info = mapped["pressing_result"]
    elif not result_ready:
        # Hold last OK/NG after Status returns to idle (HMI Pressed Result stays latched).
        # Never treat Alarm Code as Result — only restore a prior OK/NG latch.
        if not _result_latched(result_info) and _result_latched(prev_result):
            mapped["pressing_result"] = dict(prev_result)
            result_info = mapped["pressing_result"]
        for hold_key in (
            "pressed_position", "pressed_force",
            "pressed_position_step1", "pressed_position_step2", "pressed_position_step3",
            "pressed_position_step4", "pressed_position_step5",
            "standby_time", "pressing_time", "production_time",
        ):
            # Live Edge snapshot included this register → never freeze prior cycle
            if hold_key in raw_now:
                continue
            cur_v = _num(scaled.get(hold_key))
            prev_v = _num(prev_scaled.get(hold_key))
            if (cur_v is None or cur_v == 0) and prev_v is not None and prev_v != 0:
                scaled[hold_key] = prev_v

    mapped["scaled"] = scaled

    # Keep Parameters / Pressing Result table in sync with sticky counters
    for row in mapped.get("param_rows") or []:
        key = row.get("key")
        if key == "total_amount" and sticky.get("total") is not None:
            row["scaled"] = sticky["total"]
            row["value"] = f"{sticky['total']:g} pcs"
        elif key == "pass_amount" and sticky.get("good") is not None:
            row["scaled"] = sticky["good"]
            row["value"] = f"{sticky['good']:g} pcs"
        elif key == "ng_amount" and sticky.get("reject") is not None:
            row["scaled"] = sticky["reject"]
            row["value"] = f"{sticky['reject']:g} pcs"
        elif key == "production_time" and current.get("cycle_time_sec") is not None:
            ctv = current["cycle_time_sec"]
            row["scaled"] = ctv
            row["value"] = f"{ctv:g} s"
        elif key == "pressing_result" and result_info.get("label"):
            label = result_info.get("label")
            if result_info.get("reason") and result_info.get("ok") is False:
                label = f"{label} · {result_info['reason']}"
            row["scaled"] = result_info.get("code")
            row["value"] = label
        elif key in (
            "pressed_position", "pressed_force",
            "pressed_position_step1", "pressed_position_step2", "pressed_position_step3",
            "pressed_position_step4", "pressed_position_step5",
            "standby_time", "pressing_time",
        ) and scaled.get(key) is not None:
            val = scaled.get(key)
            unit = row.get("unit") or ""
            row["scaled"] = val
            if isinstance(val, (int, float)):
                row["value"] = f"{val:g} {unit}".strip()
            else:
                row["value"] = str(val)
    return mapped


def ensure_shift_production_baseline(
    runtime: Optional[dict],
    mapped: dict,
    *,
    entry_date: Optional[str] = None,
    shift_id: Optional[str] = None,
) -> dict:
    """
    Modbus Total/Pass/NG are device cumulative counters.
    Baseline them at shift start so plan OEE uses shift production = current - baseline.

    The counters also restart from a lower value when the press (or the gateway feeding
    it) is power-cycled or an operator clears them. Left unhandled the live value stays
    below the baseline and the shift reports 0 pieces for the rest of the shift, so a
    restart banks what the shift already counted and re-baselines on the new value.
    """
    rt = dict(runtime or {})
    if not entry_date or not shift_id:
        return rt
    key = f"{entry_date}:{shift_id}"
    prod = mapped.get("production") or {}
    counters = (
        ("total", _to_number(prod.get("total"))),
        ("good", _to_number(prod.get("good"))),
        ("reject", _to_number(prod.get("reject"))),
    )
    if rt.get("shift_key") != key:
        rt["shift_key"] = key
        for name, value in counters:
            # A zero read is a cleared register, not proof the device is at zero
            base = float(value or rt.get(f"last_{name}") or 0)
            rt[f"shift_base_{name}"] = base
            rt[f"shift_carry_{name}"] = 0.0
            rt[f"shift_seen_{name}"] = base
        return rt
    for name, value in counters:
        # Ignore None/0: result registers read 0 while Status*=3 clears them
        if not value:
            continue
        base = _to_number(rt.get(f"shift_base_{name}"))
        if base is None:
            rt[f"shift_base_{name}"] = float(value)
        elif value < base:
            seen = _to_number(rt.get(f"shift_seen_{name}"))
            counted = max(0.0, (seen if seen is not None else base) - base)
            rt[f"shift_carry_{name}"] = float(rt.get(f"shift_carry_{name}") or 0.0) + counted
            rt[f"shift_base_{name}"] = float(value)
        rt[f"shift_seen_{name}"] = float(value)
    return rt


def shift_production_from_runtime(mapped: dict, runtime: Optional[dict]) -> dict:
    """Shift-scoped production from cumulative Modbus counters vs shift baseline."""
    rt = runtime or {}
    prod = mapped.get("production") or {}
    total = _to_number(prod.get("total"))
    good = _to_number(prod.get("good"))
    reject = _to_number(prod.get("reject"))
    if total is None:
        return {"total": None, "good": None, "reject": None}

    def since_shift_start(name: str, value) -> Optional[int]:
        """Pieces this shift: progress against the live baseline plus pre-reset carry."""
        if value is None:
            return None
        base = _to_number(rt.get(f"shift_base_{name}")) or 0.0
        carry = _to_number(rt.get(f"shift_carry_{name}")) or 0.0
        live = float(value)
        if not live:
            # Status*=3 clears the result registers; report the last real count instead
            # of dropping the shift tiles to zero mid-cycle.
            live = float(_to_number(rt.get(f"shift_seen_{name}")) or 0.0)
        return max(0, int(carry + max(0.0, live - base)))

    shift_total = int(since_shift_start("total", total) or 0)
    shift_good = since_shift_start("good", good)
    shift_reject = since_shift_start("reject", reject)
    if shift_good is None and shift_reject is None:
        shift_good = shift_total
        shift_reject = 0
    elif shift_good is None and shift_reject is not None:
        shift_good = max(0, shift_total - shift_reject)
    elif shift_reject is None and shift_good is not None:
        shift_reject = max(0, shift_total - shift_good)
    # Prefer consistent identity total ≈ good + reject when both known
    if shift_good is not None and shift_reject is not None and shift_total == 0:
        shift_total = shift_good + shift_reject
    return {"total": shift_total, "good": shift_good, "reject": shift_reject}


def enrich_kpi_panel_with_modbus(kpi_panel: Optional[dict], telemetry: Optional[dict]) -> Optional[dict]:
    """
    DEPRECATED — do not use for Production Dashboard / CNC KPI paths.

    Servo Press OEE lives in ``servo_press_oee.compute_servo_press_oee`` and must stay
    isolated from ``machine_kpi._compute_kpi``. Kept only for backward compatibility.
    """
    return kpi_panel


def append_trend_point(history: list, mapped: dict, *, max_points: int = 60) -> list:
    """Keep a short ring of live samples for the Live Trend chart."""
    cur = mapped.get("current") or {}
    scaled_raw = mapped.get("scaled")
    scaled = scaled_raw if isinstance(scaled_raw, dict) else {}
    now = datetime.now()
    label = now.strftime("%H:%M")
    point = {
        "t": label,
        "ts": now.isoformat(timespec="seconds"),
        "position": cur.get("position_mm"),
        "load": cur.get("force_kgf"),  # chart series name kept as load
        "velocity": cur.get("velocity_mm_s"),
    }
    # AH PLC / process tags — charted on the PLC equipment overview
    for key in ("pressure", "flow", "tank_level", "temperature"):
        if key in scaled:
            point[key] = scaled.get(key)
    # Delta Screw Driver SPM
    if scaled.get("torque") is not None:
        point["torque"] = scaled.get("torque")
    if scaled.get("position_value") is not None:
        point["screw_position"] = scaled.get("position_value")
        if point.get("position") is None:
            point["position"] = scaled.get("position_value")
    out = list(history or [])
    out.append(point)
    if len(out) > max_points:
        out = out[-max_points:]
    return out


# Manufacturer alarm table §9.1 (Servo Press Alarm Code 001–012)
SERVO_PRESS_ALARM_CATALOG = {
    1: {
        "message": "Light Curtain or Safety Signal Alarm",
        "handling": (
            "1. Remove any obstructions blocking the light curtain. After resetting, resume the pressing operation.\n"
            "2. The safety signal must be under external control. After resetting the safety system, resume the pressing operation."
        ),
    },
    2: {
        "message": "Negative Limit Error",
        "handling": "Initialize the machine after resetting.",
    },
    3: {
        "message": "Positive Limit Error",
        "handling": "Initialize the machine after resetting.",
    },
    4: {
        "message": "Emergency Stop",
        "handling": "Release the emergency stop and initialize the machine after resetting.",
    },
    5: {
        "message": "Overloaded, please check the velocity or abnormal collision",
        "handling": "Reconfirm the pressing parameters to prevent the pressing force from exceeding the limit.",
    },
    6: {
        "message": "Please release ON when switching mode",
        "handling": "Switch off the internal/external control knob after deactivation.",
    },
    7: {
        "message": "Hits workpiece in High-speed section",
        "handling": (
            "When moving to the ready position, the pressure exceeds the machine's protection threshold "
            "(default is 10% of the maximum pressure):\n"
            "1. Check if the pressing parameter [Ready Position] is set appropriately.\n"
            "2. Check for any material stacking issues.\n"
            "3. Check the mechanism beneath the press load cell for linearity and ensure there is no "
            "damping or resistance during vertical movement."
        ),
    },
    8: {
        "message": "Currency overloaded, please check the velocity or abnormal collision",
        "handling": (
            "Motor Current Exceeds 100%:\n"
            "1. Reconfirm the pressing parameters to avoid excessive pressing force.\n"
            "2. Ensure the motor brake is released.\n"
            "3. Check for foreign objects when moving to the working position.\n"
            "4. Verify the lower fixture is not too heavy; after an emergency stop or light curtain "
            "trigger, inertial force may cause motor overload."
        ),
    },
    9: {
        "message": "Motor Alarm. If reset is not working, please restart the servo press",
        "handling": "Refer to Chapter 9.2 Motor Alarm.",
    },
    10: {
        "message": "Servo Communication Error",
        "handling": (
            "RS485 Communication Interrupted Between Servo and PLC:\n"
            "1. Power cycle the system. If the issue persists, contact the distributor.\n"
            "2. For electric cylinder types, check whether the wiring between the PLC and the driver "
            "is loose or incorrectly connected."
        ),
    },
    11: {
        "message": "Light curtain alarm, please reset then go home",
        "handling": (
            "The light curtain was triggered accidentally. After resetting, the spindle returns to "
            "the working origin and waits for the pressing signal again."
        ),
    },
    12: {
        "message": "Two hand buttons released, please reset then go home",
        "handling": (
            "Release the two-hand switch. After resetting, the spindle returns to the working origin "
            "and waits for the pressing signal again."
        ),
    },
}


def servo_press_alarm_info(code: Optional[float]) -> dict:
    """Return {code, code_label, message, handling} for Alarm Code 1–12."""
    if code is None:
        return {
            "code": None,
            "code_label": "-",
            "message": "No Alarm",
            "handling": None,
        }
    try:
        c = int(float(code))
    except (TypeError, ValueError):
        return {
            "code": None,
            "code_label": "-",
            "message": "No Alarm",
            "handling": None,
        }
    if c == 0:
        return {
            "code": 0,
            "code_label": "000",
            "message": "No Alarm",
            "handling": None,
        }
    row = SERVO_PRESS_ALARM_CATALOG.get(c)
    code_label = f"{c:03d}"
    if not row:
        return {
            "code": c,
            "code_label": code_label,
            "message": f"Alarm Code {code_label}",
            "handling": None,
        }
    return {
        "code": c,
        "code_label": code_label,
        "message": row["message"],
        "handling": row["handling"],
    }


def _alarm_label(code: Optional[float]) -> str:
    info = servo_press_alarm_info(code)
    if info.get("code") in (None, 0):
        return "No Alarm"
    return f"{info['code_label']} · {info['message']}"


PLC_THRESHOLD_TAGS = (
    ("pressure", "Pressure", "kPa"),
    ("flow", "Flow", "L/min"),
    ("tank_level", "Tank Level", "%"),
    ("temperature", "Temperature", "\u00b0C"),
)


def normalize_plc_thresholds(raw: Any) -> dict:
    """Sanitize {tag_key: {lsl, usl, enabled}} for PLC process tags."""
    src = raw if isinstance(raw, dict) else {}
    out: dict[str, dict] = {}
    for key, _label, unit in PLC_THRESHOLD_TAGS:
        row = src.get(key) if isinstance(src.get(key), dict) else {}
        lsl = row.get("lsl")
        usl = row.get("usl")
        try:
            lsl_f = float(lsl) if lsl is not None and lsl != "" else None
        except (TypeError, ValueError):
            lsl_f = None
        try:
            usl_f = float(usl) if usl is not None and usl != "" else None
        except (TypeError, ValueError):
            usl_f = None
        if lsl_f is not None and usl_f is not None and lsl_f > usl_f:
            lsl_f, usl_f = usl_f, lsl_f
        enabled = row.get("enabled")
        if enabled is None:
            enabled = lsl_f is not None or usl_f is not None
        out[key] = {
            "lsl": lsl_f,
            "usl": usl_f,
            "enabled": bool(enabled),
            "unit": unit,
            "label": _label,
        }
    return out


def evaluate_plc_threshold_breaches(scaled: dict, thresholds: dict) -> dict:
    """Return {tag_key: {side, value, lsl, usl, label}} for active breaches."""
    scaled = scaled if isinstance(scaled, dict) else {}
    thresholds = normalize_plc_thresholds(thresholds)
    breaches: dict[str, dict] = {}
    for key, meta in thresholds.items():
        if not meta.get("enabled"):
            continue
        val = scaled.get(key)
        if val is None:
            continue
        try:
            num = float(val)
        except (TypeError, ValueError):
            continue
        lsl = meta.get("lsl")
        usl = meta.get("usl")
        side = None
        if usl is not None and num > float(usl):
            side = "high"
        elif lsl is not None and num < float(lsl):
            side = "low"
        if side:
            breaches[key] = {
                "tag_key": key,
                "label": meta.get("label") or key,
                "unit": meta.get("unit") or "",
                "side": side,
                "value": num,
                "lsl": lsl,
                "usl": usl,
            }
    return breaches


def append_plc_threshold_alarms(
    alarms: list,
    mapped: dict,
    *,
    thresholds: dict,
    machine_id: Optional[int] = None,
    max_events: int = 80,
) -> tuple[list, dict]:
    """
    Raise/clear alarms when PLC process values cross configured LSL/USL.
    Returns (alarms_list, active_breaches).
    """
    scaled = (mapped.get("scaled") or {}) if isinstance(mapped, dict) else {}
    thresholds = normalize_plc_thresholds(thresholds)
    breaches = evaluate_plc_threshold_breaches(scaled, thresholds)
    out = list(alarms or [])

    # Active breach keys from last open raise (without a later clear for same tag+side)
    active: dict[str, str] = {}  # "pressure:high" -> event_id
    for ev in out:
        if not isinstance(ev, dict) or ev.get("kind") != "plc_threshold":
            continue
        tag = ev.get("tag_key")
        side = ev.get("side")
        if not tag or not side:
            continue
        k = f"{tag}:{side}"
        if ev.get("event") in ("raised", "active") and ev.get("active") is not False:
            active[k] = str(ev.get("event_id") or "")
        elif ev.get("event") == "cleared":
            active.pop(k, None)

    now = datetime.now()
    ts = now.isoformat(timespec="seconds")
    tlab = now.strftime("%H:%M:%S")
    mid = machine_id if machine_id is not None else 0

    # Raise new breaches
    for key, br in breaches.items():
        side = br["side"]
        state_key = f"{key}:{side}"
        if state_key in active:
            continue
        event_id = f"EVT-{mid}-{key[:3].upper()}-{side[0].upper()}-{now.strftime('%Y%m%d%H%M%S')}-{len(out) % 100:02d}"
        unit = br.get("unit") or ""
        limit = br.get("usl") if side == "high" else br.get("lsl")
        label = (
            f"{br.get('label')} {'above USL' if side == 'high' else 'below LSL'} "
            f"({br.get('value'):g} {unit} vs {limit:g} {unit})".strip()
        )
        out.append({
            "ts": ts,
            "t": tlab,
            "kind": "plc_threshold",
            "event_id": event_id,
            "code": event_id,
            "label": label,
            "tag_key": key,
            "side": side,
            "value": br.get("value"),
            "lsl": br.get("lsl"),
            "usl": br.get("usl"),
            "unit": unit,
            "event": "raised",
            "active": True,
            "started_at": ts,
        })
        active[state_key] = event_id

    # Clear recovered tags
    current_keys = {f"{k}:{v['side']}" for k, v in breaches.items()}
    for state_key, event_id in list(active.items()):
        if state_key in current_keys:
            continue
        tag, side = state_key.split(":", 1)
        meta = thresholds.get(tag) or {}
        out.append({
            "ts": ts,
            "t": tlab,
            "kind": "plc_threshold",
            "event_id": event_id or f"EVT-{mid}-{tag}-CLR-{now.strftime('%Y%m%d%H%M%S')}",
            "code": event_id or "cleared",
            "label": f"{meta.get('label') or tag} back within limits",
            "tag_key": tag,
            "side": side,
            "value": scaled.get(tag),
            "lsl": meta.get("lsl"),
            "usl": meta.get("usl"),
            "unit": meta.get("unit") or "",
            "event": "cleared",
            "active": False,
            "cleared_at": ts,
        })
        active.pop(state_key, None)

    if len(out) > max_events:
        out = out[-max_events:]
    return out, breaches


def append_alarm_events(
    alarms: list,
    mapped: dict,
    *,
    prev_alarm: Optional[float] = None,
    max_events: int = 80,
) -> list:
    """Append alarm raise/clear events when Modbus Alarm Code changes."""
    scaled = mapped.get("scaled") or {}
    alarm = scaled.get("alarm_code")
    if alarm is None:
        return list(alarms or [])
    try:
        code = float(alarm)
    except (TypeError, ValueError):
        return list(alarms or [])
    out = list(alarms or [])
    prev = None if prev_alarm is None else float(prev_alarm)
    now = datetime.now()
    ts = now.isoformat(timespec="seconds")
    status = (mapped.get("status") or {}).get("display") or (mapped.get("status") or {}).get("label")
    result = (mapped.get("pressing_result") or {}).get("label")

    if prev is None:
        if code != 0:
            info = servo_press_alarm_info(code)
            out.append({
                "ts": ts,
                "t": now.strftime("%H:%M:%S"),
                "code": int(code),
                "code_label": info.get("code_label"),
                "label": info.get("message") or _alarm_label(code),
                "message": info.get("message"),
                "handling": info.get("handling"),
                "event": "active",
                "status": status,
                "pressing_result": result,
                "active": True,
            })
    elif code != prev:
        if code != 0:
            info = servo_press_alarm_info(code)
            out.append({
                "ts": ts,
                "t": now.strftime("%H:%M:%S"),
                "code": int(code),
                "code_label": info.get("code_label"),
                "label": info.get("message") or _alarm_label(code),
                "message": info.get("message"),
                "handling": info.get("handling"),
                "event": "raised",
                "status": status,
                "pressing_result": result,
                "active": True,
            })
        else:
            info = servo_press_alarm_info(prev)
            out.append({
                "ts": ts,
                "t": now.strftime("%H:%M:%S"),
                "code": int(prev),
                "code_label": info.get("code_label"),
                "label": info.get("message") or _alarm_label(prev),
                "message": info.get("message"),
                "handling": info.get("handling"),
                "event": "cleared",
                "status": status,
                "pressing_result": result,
                "active": False,
            })
    if len(out) > max_events:
        out = out[-max_events:]
    return out


def append_history_snapshot(
    history: list,
    mapped: dict,
    *,
    force: bool = False,
    max_events: int = 80,
) -> list:
    """
    Record production/status history when counters or phase change.
    For AH PLC catalogs, also snapshot when process tags (pressure/flow/…) move.
    """
    scaled = mapped.get("scaled") or {}
    status = mapped.get("status") or {}
    prod = mapped.get("production") or {}
    now = datetime.now()

    def _round_tag(key: str):
        val = scaled.get(key)
        if val is None:
            return None
        try:
            return round(float(val), 2)
        except (TypeError, ValueError):
            return val

    pressure = _round_tag("pressure")
    flow = _round_tag("flow")
    tank_level = _round_tag("tank_level")
    temperature = _round_tag("temperature")
    digital_io = mapped.get("digital_io") or {}

    def _pack_bits(side: str) -> Optional[int]:
        items = digital_io.get(side) or []
        if not items:
            return None
        word = 0
        known = False
        for idx, item in enumerate(items):
            on = item.get("on") if isinstance(item, dict) else None
            if on is None:
                continue
            known = True
            if on:
                word |= 1 << idx
        return word if known else None

    di_bits = _pack_bits("inputs")
    do_bits = _pack_bits("outputs")
    di = scaled.get("digital_input_status")
    do = scaled.get("digital_output_status")
    if di is None and di_bits is not None:
        di = di_bits
    if do is None and do_bits is not None:
        do = do_bits

    snap = {
        "ts": now.isoformat(timespec="seconds"),
        "t": now.strftime("%H:%M:%S"),
        "status_code": status.get("code"),
        "status": status.get("display") or status.get("label"),
        "phase": status.get("phase"),
        "phase_label": status.get("phase_label"),
        "total": prod.get("total"),
        "good": prod.get("good"),
        "reject": prod.get("reject"),
        "position_mm": (mapped.get("current") or {}).get("position_mm"),
        "force_kgf": (mapped.get("current") or {}).get("force_kgf"),
        "cycle_time_sec": (mapped.get("current") or {}).get("cycle_time_sec"),
        "alarm_code": scaled.get("alarm_code"),
        "pressing_result": (mapped.get("pressing_result") or {}).get("label"),
        "recipe": scaled.get("recipe_number"),
        "pressure": pressure,
        "flow": flow,
        "tank_level": tank_level,
        "temperature": temperature,
        "digital_input_status": di,
        "digital_output_status": do,
        "di_bits": di_bits,
        "do_bits": do_bits,
        "plc_status": scaled.get("plc_status"),
    }
    out = list(history or [])
    has_plc = any(v is not None for v in (pressure, flow, tank_level, temperature, di_bits, do_bits))
    if not force and out:
        last = out[-1]
        same = (
            last.get("status_code") == snap["status_code"]
            and last.get("total") == snap["total"]
            and last.get("good") == snap["good"]
            and last.get("reject") == snap["reject"]
            and last.get("alarm_code") == snap["alarm_code"]
            and last.get("pressing_result") == snap["pressing_result"]
            and last.get("pressure") == snap["pressure"]
            and last.get("flow") == snap["flow"]
            and last.get("tank_level") == snap["tank_level"]
            and last.get("temperature") == snap["temperature"]
            and last.get("digital_input_status") == snap["digital_input_status"]
            and last.get("digital_output_status") == snap["digital_output_status"]
            and last.get("di_bits") == snap["di_bits"]
            and last.get("do_bits") == snap["do_bits"]
        )
        if same:
            return out[-max_events:] if len(out) > max_events else out
        # PLC process feed: keep a denser history, but not every identical tick
        if has_plc and len(out) >= 2:
            # Drop nothing — values already differ from last
            pass
    out.append(snap)
    if len(out) > max_events:
        out = out[-max_events:]
    return out

def update_runtime_stats(runtime: Optional[dict], mapped: dict) -> dict:
    """Accumulate phase seconds between telemetry posts for Modbus OEE."""
    now = datetime.now()
    rt = dict(runtime or {})
    phase = (mapped.get("status") or {}).get("phase") or "other"
    alarm = (mapped.get("scaled") or {}).get("alarm_code")
    try:
        alarm_active = alarm is not None and float(alarm) != 0
    except (TypeError, ValueError):
        alarm_active = False
    if alarm_active:
        phase_key = "alarm"
    elif phase == "pressing":
        phase_key = "pressing"
    elif phase == "result":
        phase_key = "result"
    elif phase == "idle":
        phase_key = "idle"
    else:
        phase_key = "other"

    last_ts_raw = rt.get("last_ts")
    last_phase = rt.get("last_phase") or phase_key
    if last_ts_raw:
        try:
            last_ts = datetime.fromisoformat(str(last_ts_raw))
            dt = max(0.0, min((now - last_ts).total_seconds(), 30.0))  # clamp gaps
        except Exception:
            dt = 0.0
    else:
        dt = 0.0
        rt["started_at"] = now.isoformat(timespec="seconds")

    buckets = rt.setdefault("seconds", {
        "pressing": 0.0, "result": 0.0, "idle": 0.0, "alarm": 0.0, "other": 0.0,
    })
    if dt > 0 and last_phase in buckets:
        buckets[last_phase] = float(buckets.get(last_phase) or 0) + dt

    # Track production counter deltas for PR (ignore Modbus clears during Pressing)
    prod = mapped.get("production") or {}
    phase = (mapped.get("status") or {}).get("phase") or "other"
    result_ready = bool((mapped.get("status") or {}).get("result_ready"))
    total = prod.get("total")
    good = prod.get("good")
    reject = prod.get("reject")
    if total is not None:
        try:
            total_f = float(total)
            # Status*=3 clears result registers — do not treat as counter reset
            cleared = phase == "pressing" or (total_f == 0 and not result_ready and float(rt.get("last_total") or 0) > 0)
            if cleared:
                pass
            else:
                prev_total = rt.get("last_total")
                if prev_total is not None and total_f >= float(prev_total):
                    rt["cycles_delta"] = float(rt.get("cycles_delta") or 0) + (total_f - float(prev_total))
                elif prev_total is None:
                    rt["cycles_delta"] = float(rt.get("cycles_delta") or 0)
                rt["last_total"] = total_f
                if good is not None:
                    rt["last_good"] = float(good)
                if reject is not None:
                    rt["last_reject"] = float(reject)
        except (TypeError, ValueError):
            pass
    # Persist holds even when only good/reject update on Result ready
    if result_ready:
        try:
            if good is not None:
                rt["last_good"] = float(good)
            if reject is not None:
                rt["last_reject"] = float(reject)
            if total is not None and float(total) > 0:
                rt["last_total"] = float(total)
        except (TypeError, ValueError):
            pass

    ct = (mapped.get("current") or {}).get("cycle_time_sec")
    if ct is not None:
        try:
            # production_time also clears during pressing — keep last good cycle time
            ct_f = float(ct)
            if phase == "pressing" and ct_f == 0:
                pass
            elif ct_f > 0:
                rt["last_cycle_time_sec"] = ct_f
        except (TypeError, ValueError):
            pass

    rt["last_ts"] = now.isoformat(timespec="seconds")
    rt["last_phase"] = phase_key
    rt["seconds"] = buckets
    return rt


def compute_modbus_kpi(mapped: dict, runtime: Optional[dict] = None) -> dict:
    """
    Modbus-derived OEE when PMS plan/status KPI is unavailable.
    AR ≈ productive phases / tracked time
    PR ≈ (cycles × cycle_time) / productive time
    QR = pass / total from Modbus counters
    """
    prod = mapped.get("production") or {}
    total = _to_number(prod.get("total"))
    good = _to_number(prod.get("good"))
    reject = _to_number(prod.get("reject"))
    if good is None and total is not None and reject is not None:
        good = max(0.0, total - reject)
    if total is None and good is not None and reject is not None:
        total = good + reject

    qr = round((good / total) * 100, 2) if total and total > 0 and good is not None else None

    rt = runtime or {}
    buckets = rt.get("seconds") or {}
    pressing = float(buckets.get("pressing") or 0)
    result = float(buckets.get("result") or 0)
    idle = float(buckets.get("idle") or 0)
    alarm = float(buckets.get("alarm") or 0)
    other = float(buckets.get("other") or 0)
    tracked = pressing + result + idle + alarm + other
    productive = pressing + result

    ar = round((productive / tracked) * 100, 2) if tracked >= 4 else None

    cycles = float(rt.get("cycles_delta") or 0)
    ct = _to_number((mapped.get("current") or {}).get("cycle_time_sec")) or _to_number(rt.get("last_cycle_time_sec"))
    pr = None
    if ct and ct > 0 and productive >= 4 and cycles > 0:
        expected_from_time = productive / ct
        if expected_from_time > 0:
            pr = round(min((cycles / expected_from_time) * 100, 100.0), 2)

    # Prefer full OEE; if PR still warming up, assume PR=100 until cycle deltas stabilize
    oee = None
    if ar is not None and qr is not None:
        pr_eff = pr if pr is not None else 100.0
        oee = round(min(ar * pr_eff * qr / 10000, 100.0), 2)
        if pr is None:
            pr = 100.0

    return {
        "source": "modbus",
        "kpi": {
            "oee": oee,
            "ar": ar,
            "pr": pr,
            "qr": qr,
            "machine_utilization": ar,
            "production_yield": qr,
            "teep": oee,
        },
        "actual_qty": int(total) if total is not None else None,
        "good_qty": int(good) if good is not None else None,
        "defect_qty": int(reject) if reject is not None else None,
        "available_time_min": round(tracked / 60.0, 1) if tracked else 0,
        "operating_time_min": round(productive / 60.0, 1) if productive else 0,
        "uptime_min": round(pressing / 60.0, 1),
        "downtime_min": round((idle + alarm + other) / 60.0, 1),
        "actual_production_time_min": round(pressing / 60.0, 1),
        "cycle_time_sec": ct,
        "note": "Derived from Modbus Status*/Alarm/production counters (no production plan).",
        "runtime_seconds": buckets,
        "tracked_sec": round(tracked, 1),
        "cycles_delta": cycles,
    }
