"""Generic PLC process setpoint alerts (non-AH kits)."""
from __future__ import annotations

from typing import List, Optional

from sqlalchemy.orm import Session

from ..models import Machine, now_ist
from .base import (
    ProcessAlertModule,
    build_setpoint_alarm_email,
    enrich_machine_context,
    send_process_setpoint_email,
)


class GenericPlcAlertModule(ProcessAlertModule):
    module_id = "generic_plc"
    label = "PLC"
    profile_ids = ("generic_plc",)
    machine_type_hints = ("plc",)

    def matches(self, *, profile_id: str = "", machine_type: str = "", machine_name: str = "") -> bool:
        mtype = (machine_type or "").strip().upper()
        mname = (machine_name or "").strip().upper()
        # Leave SPM_AH_PLC to the dedicated module (type or equipment name)
        if "SPM_AH" in mtype or "AH_PLC" in mtype or "SPM_AH" in mname or "AH_PLC" in mname:
            return False
        if mtype == "PLC" or mtype.endswith(" PLC"):
            return True
        return False

    def describe(self) -> dict:
        return {
            "module_id": self.module_id,
            "label": self.label,
            "profile_ids": list(self.profile_ids),
            "parameters": [
                {"key": "pressure", "label": "Pressure", "unit": "kPa"},
                {"key": "flow", "label": "Flow", "unit": "L/min"},
                {"key": "tank_level", "label": "Tank Level", "unit": "%"},
                {"key": "temperature", "label": "Temperature", "unit": "°C"},
            ],
            "how": (
                "Same LSL/USL Parameters limits as other PLC dashboards. "
                "Wired separately so AH PLC and generic PLC alerts stay modular."
            ),
            "ui_path": "/overview/equipment",
            "report_type": "process_setpoint_alerts",
        }

    def on_raised_events(
        self,
        db: Session,
        *,
        machine: Machine,
        raised_events: List[dict],
    ) -> Optional[dict]:
        if not raised_events:
            return None
        ctx = enrich_machine_context(db, machine)
        subject, body, body_html = build_setpoint_alarm_email(
            ctx=ctx,
            raised_events=raised_events,
            deviation_time=now_ist(),
        )
        return send_process_setpoint_email(
            db,
            machine=machine,
            module_id=self.module_id,
            subject=subject,
            body=body,
            body_html=body_html,
            raised_events=raised_events,
            alert_prefix="gplc",
        )
