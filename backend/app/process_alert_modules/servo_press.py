"""Servo Press process / alarm setpoint alerts (placeholder — ready to extend)."""
from __future__ import annotations

from typing import List, Optional

from sqlalchemy.orm import Session

from ..models import Machine
from .base import ProcessAlertModule


class ServoPressAlertModule(ProcessAlertModule):
    module_id = "servo_press"
    label = "Servo Press"
    profile_ids = ("servo_press",)
    machine_type_hints = ("servo press", "servo_press")

    def describe(self) -> dict:
        return {
            "module_id": self.module_id,
            "label": self.label,
            "profile_ids": list(self.profile_ids),
            "parameters": [
                {"key": "alarm_code", "label": "Alarm Code", "unit": ""},
                {"key": "live_force", "label": "Force", "unit": "kgf"},
                {"key": "live_position", "label": "Position", "unit": "mm"},
            ],
            "how": (
                "Uses the existing Modbus Alarm Code path today. "
                "LSL/USL process emails can be added here without loading PLC modules."
            ),
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
        # Intentionally no-op until Servo Press setpoint emails are enabled
        return None
