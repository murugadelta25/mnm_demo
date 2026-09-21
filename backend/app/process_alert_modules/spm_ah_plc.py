"""SPM_AH_PLC process setpoint alerts (Pressure / Flow / Tank / Temperature LSL·USL)."""
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


class SpmAhPlcAlertModule(ProcessAlertModule):
    module_id = "spm_ah_plc"
    label = "SPM AH PLC"
    profile_ids = ("generic_plc",)
    machine_type_hints = ("spm_ah_plc", "ah_plc", "spm ah")

    def matches(self, *, profile_id: str = "", machine_type: str = "", machine_name: str = "") -> bool:
        mtype = (machine_type or "").strip().lower()
        mname = (machine_name or "").strip().lower()
        pid = (profile_id or "").strip().lower()
        if any(h in mtype for h in ("spm_ah", "ah_plc", "spm ah")):
            return True
        if any(h in mname for h in ("spm_ah", "ah_plc", "spm ah")):
            return True
        # AH kit uses generic_plc profile — claim it unless clearly a plain PLC type/name
        if pid == "generic_plc":
            if mtype in ("plc",) or (mtype.endswith(" plc") and "ah" not in mtype and "spm" not in mtype):
                # Still claim when equipment name is AH
                if any(h in mname for h in ("spm_ah", "ah_plc", "spm ah")):
                    return True
                return False
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
                "Set LSL/USL on Equipment Overview → Parameters → Set Limits. "
                "When a live value crosses a limit, this module emails groups that include "
                "Process Setpoint Alerts."
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
            alert_prefix="ahplc",
        )
