"""
Registry for machine-family process setpoint alert modules.

Each family lives in its own file so loading SPM AH PLC does not pull Servo Press
or Linear Motor logic. Call resolve_module(...) only for the active machine.
"""
from __future__ import annotations

from typing import List, Optional

from sqlalchemy.orm import Session

from ..models import Machine
from .base import ProcessAlertModule, PROCESS_SETPOINT_REPORT_KEY, recipients_for_process_setpoints
from .spm_ah_plc import SpmAhPlcAlertModule
from .generic_plc import GenericPlcAlertModule
from .servo_press import ServoPressAlertModule
from .linear_motor import LinearMotorAlertModule
from .spm_generic import SpmGenericAlertModule

# Order matters: more specific modules first (AH PLC before generic PLC / SPM)
_MODULES: List[ProcessAlertModule] = [
    SpmAhPlcAlertModule(),
    GenericPlcAlertModule(),
    ServoPressAlertModule(),
    LinearMotorAlertModule(),
    SpmGenericAlertModule(),
]


def list_modules() -> List[dict]:
    return [m.describe() for m in _MODULES]


def resolve_module(
    *,
    profile_id: str = "",
    machine_type: str = "",
    machine_name: str = "",
) -> Optional[ProcessAlertModule]:
    for mod in _MODULES:
        if mod.matches(profile_id=profile_id, machine_type=machine_type, machine_name=machine_name):
            return mod
    return None


def dispatch_raised_events(
    db: Session,
    *,
    machine: Machine,
    profile_id: str = "",
    raised_events: list,
) -> Optional[dict]:
    """Route new threshold events to the matching machine-family module only."""
    if not raised_events:
        return None
    mtype = getattr(machine, "machine_type", None) or getattr(machine, "type", None) or ""
    mname = getattr(machine, "name", None) or ""
    mod = resolve_module(profile_id=profile_id, machine_type=str(mtype), machine_name=str(mname))
    if not mod:
        # Default AH/PLC process tags to SPM AH module when profile is generic_plc
        if (profile_id or "") == "generic_plc":
            mod = SpmAhPlcAlertModule()
        else:
            return None
    return mod.on_raised_events(db, machine=machine, raised_events=raised_events)


__all__ = [
    "PROCESS_SETPOINT_REPORT_KEY",
    "recipients_for_process_setpoints",
    "list_modules",
    "resolve_module",
    "dispatch_raised_events",
]
