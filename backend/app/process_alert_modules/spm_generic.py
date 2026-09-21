"""Generic SPM machine process setpoint alerts (placeholder)."""
from __future__ import annotations

from typing import List, Optional

from sqlalchemy.orm import Session

from ..models import Machine
from .base import ProcessAlertModule


class SpmGenericAlertModule(ProcessAlertModule):
    module_id = "spm"
    label = "SPM Machine"
    profile_ids = ("spm",)
    machine_type_hints = ("spm",)

    def matches(self, *, profile_id: str = "", machine_type: str = "") -> bool:
        mtype = (machine_type or "").strip().upper()
        if "SPM_AH" in mtype or "AH_PLC" in mtype:
            return False
        return "SPM" in mtype or (profile_id or "").lower() == "spm"

    def describe(self) -> dict:
        return {
            "module_id": self.module_id,
            "label": self.label,
            "profile_ids": list(self.profile_ids),
            "parameters": [],
            "how": "Reserved SPM module — keep separate from AH PLC and Servo Press.",
            "ui_path": "/overview/equipment",
            "report_type": "process_setpoint_alerts",
            "active": False,
        }

    def on_raised_events(
        self,
        db: Session,
        *,
        machine: Machine,
        raised_events: List[dict],
    ) -> Optional[dict]:
        return None
