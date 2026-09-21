"""Servo Linear Motor process setpoint alerts (placeholder module)."""
from __future__ import annotations

from typing import List, Optional

from sqlalchemy.orm import Session

from ..models import Machine
from .base import ProcessAlertModule


class LinearMotorAlertModule(ProcessAlertModule):
    module_id = "linear_motor"
    label = "Servo Linear Motor"
    profile_ids = ("linear_motor", "servo_linear_motor")
    machine_type_hints = ("linear motor", "servo linear")

    def describe(self) -> dict:
        return {
            "module_id": self.module_id,
            "label": self.label,
            "profile_ids": list(self.profile_ids),
            "parameters": [
                {"key": "position", "label": "Position", "unit": "mm"},
                {"key": "velocity", "label": "Velocity", "unit": "mm/s"},
            ],
            "how": "Standalone module — enable setpoint emails here when Linear Motor limits are configured.",
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
