"""
Machine telemetry profiles — scalable parameter screens per machine type.

Servo Press ships with Modbus §8.4.2 as the default profile.
Tags are editable via Machine Config → Telemetry Tags (DB-backed).
Other types (CNC / generic PLC) can reuse the same screen shell by registering
a profile (groups + parameters). Unmapped Node-RED tags still appear under
group "other" / Live Status extras.
"""
from __future__ import annotations

import re
from typing import Any, Optional

from .servo_press_modbus import SERVO_PRESS_REGISTERS

# Machine types whose Equipment Overview uses the Modbus telemetry dashboard — the
# screen first built for Servo Press — instead of the generic equipment tiles.
# They all feed Live / Result parameters through mapped Node-RED tags, so the same
# layout, status derivation and Modbus OEE apply.
TELEMETRY_DASHBOARD_MACHINE_TYPES = ("Servo Press", "Servo Linear Motor", "PLC", "SPM")


def is_telemetry_dashboard_type(machine_type: Optional[str]) -> bool:
    """True for Servo Press, Servo Linear Motor, PLC and SPM, however they are spelt."""
    normalized = re.sub(r"[^a-z0-9]+", " ", str(machine_type or "").lower()).strip()
    if not normalized:
        return False
    tokens = set(normalized.split())
    if "servopress" in tokens or ("servo" in tokens and ("press" in tokens or "linear" in tokens)):
        return True
    return bool(tokens & {"plc", "spm"})


def _regs_as_list(registers: dict) -> list[dict]:
    out = []
    for key, meta in (registers or {}).items():
        row = {"key": key, **meta}
        out.append(row)
    return out


TELEMETRY_PROFILES: dict[str, dict[str, Any]] = {
    "servo_press": {
        "id": "servo_press",
        "label": "Servo Press Modbus §8.4.2",
        "machine_types": ["Servo Press"],
        "source": "modbus",
        "screens": [
            {
                "id": "live",
                "label": "Live Status",
                "group": "live",
                "rule": "Readable anytime (Status Data).",
            },
            {
                "id": "result",
                "label": "Pressing Result",
                "group": "result",
                "rule": "Read when Status* is 4-8 (Result ready). Clears when Status* becomes 3 (Pressing).",
            },
        ],
        "registers": SERVO_PRESS_REGISTERS,
        "how_to_extend": (
            "Machine Config → select type Servo Press → Config Tags "
            "(Item, Node-RED name, Modbus, EIP/PN, Type, Scale, Unit, Group=Live|Result)."
        ),
    },
    "servo_linear_motor": {
        "id": "servo_linear_motor",
        "label": "Servo Linear Motor tags",
        "machine_types": ["Servo Linear Motor"],
        "source": "modbus",
        "screens": [
            {
                "id": "live",
                "label": "Live Status",
                "group": "live",
                "rule": (
                    "Read registers %MW20-%MW32 (Modbus 40021-40033): power enable, "
                    "current position, DC voltage, limits, alarm, run time."
                ),
            },
            {
                "id": "result",
                "label": "Setpoints (Write)",
                "group": "result",
                "rule": (
                    "Write registers %MW0-%MW6 (Modbus 40001-40007): enable, position, "
                    "speed, ACC, Decc, home and brake commands."
                ),
            },
        ],
        "registers": {},
        "how_to_extend": (
            "Machine Config → select type Servo Linear Motor → Config Tags."
        ),
    },
    "spm": {
        "id": "spm",
        "label": "SPM (Special Purpose Machine) tags",
        "machine_types": ["SPM"],
        "source": "modbus",
        "screens": [
            {
                "id": "live",
                "label": "Live Status",
                "group": "live",
                "rule": "Readable anytime.",
            },
            {
                "id": "result",
                "label": "Cycle Result",
                "group": "result",
                "rule": "Result / cycle tags.",
            },
        ],
        "registers": {},
        "how_to_extend": (
            "Machine Config → select type SPM → Config Tags."
        ),
    },
    "generic_plc": {
        "id": "generic_plc",
        "label": "Generic PLC / Edge tags",
        "machine_types": ["PLC", "CNC", "VMC", "HMC", "Turning", "Grinding", "Other"],
        "source": "plc",
        "screens": [
            {
                "id": "live",
                "label": "Live Tags",
                "group": "live",
                "rule": "Any Node-RED readings mapped to group live (or unmapped → other).",
            },
            {
                "id": "result",
                "label": "Result Tags",
                "group": "result",
                "rule": "Tags with group=result in the profile, or future PLC result block.",
            },
        ],
        "registers": {},
        "how_to_extend": (
            "Machine Config → select type PLC → Config Tags."
        ),
    },
}


def resolve_profile_for_machine_type(machine_type: Optional[str], db=None) -> dict:
    mt = (machine_type or "").strip().lower()
    for profile in TELEMETRY_PROFILES.values():
        for cand in profile.get("machine_types") or []:
            if cand.lower() == mt or cand.lower() in mt or mt in cand.lower():
                return public_profile(profile, db=db)
    return public_profile(TELEMETRY_PROFILES["generic_plc"], db=db)


def public_profile(profile: dict, db=None) -> dict:
    regs = profile.get("registers") or {}
    if db is not None and profile.get("id") in ("servo_press", "servo_linear_motor", "spm", "generic_plc"):
        try:
            from .telemetry_tags_service import get_registers_and_aliases
            regs, _ = get_registers_and_aliases(db, profile_id=profile["id"])
        except Exception:
            pass
    return {
        "id": profile["id"],
        "label": profile["label"],
        "machine_types": list(profile.get("machine_types") or []),
        "source": profile.get("source"),
        "screens": list(profile.get("screens") or []),
        "registers": regs,
        "parameters": _regs_as_list(regs),
        "how_to_extend": profile.get("how_to_extend"),
        "oee_note": (
            "OEE / AR / PR / QR always use existing PMS machine_kpi formulas "
            "(production plans + status segments). Telemetry does not replace OEE math."
        ),
    }


def list_profiles(db=None) -> list[dict]:
    return [public_profile(p, db=db) for p in TELEMETRY_PROFILES.values()]
