"""
Process Setpoint Alerts API — separate from classic Email Alerts / OEE schedules.

Machine-family modules live under app/process_alert_modules/ and are loaded
on demand so SPM AH PLC does not pull Servo Press / Linear Motor code paths.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import List, Optional

from ..models import get_db, EmailGroup, EmailRecipient, EmailSmtpConfig, Machine
from ..auth import get_current_user, require_role
from ..process_alert_modules import (
    PROCESS_SETPOINT_REPORT_KEY,
    list_modules,
    resolve_module,
)
from ..process_alert_modules.base import recipients_for_process_setpoints

router = APIRouter(prefix="/api/process-setpoint-alerts", tags=["process-setpoint-alerts"])


class SetpointGroupIn(BaseModel):
    name: str
    description: str = ""
    module_ids: List[str] = []  # informational; routing uses report_types key


class SetpointRecipientIn(BaseModel):
    group_id: int
    name: str
    email: str
    active: int = 1


@router.get("/modules")
def get_modules(_=Depends(get_current_user)):
    """List machine-family alert modules (metadata only — no heavy imports beyond registry)."""
    return {
        "report_type": PROCESS_SETPOINT_REPORT_KEY,
        "modules": list_modules(),
        "how_setpoints_work": (
            "1) Open Equipment Overview for the machine. "
            "2) Parameters → Set Limits (LSL / USL). "
            "3) When live telemetry crosses a limit, the matching module emails "
            "groups that include Process Setpoint Alerts."
        ),
    }


@router.get("/status")
def get_status(db: Session = Depends(get_db), _=Depends(get_current_user)):
    smtp = db.query(EmailSmtpConfig).first()
    groups = (
        db.query(EmailGroup)
        .all()
    )
    setpoint_groups = []
    for g in groups:
        rts = {r.strip() for r in (g.report_types or "").split(",") if r.strip()}
        if PROCESS_SETPOINT_REPORT_KEY in rts:
            members = db.query(EmailRecipient).filter(EmailRecipient.group_id == g.id).all()
            setpoint_groups.append({
                "id": g.id,
                "name": g.name,
                "description": g.description,
                "report_types": g.report_types,
                "count": len([m for m in members if m.active]),
                "members": [
                    {"id": m.id, "name": m.name, "email": m.email, "active": m.active}
                    for m in members
                ],
            })
    recipients = recipients_for_process_setpoints(db)
    return {
        "smtp_configured": bool(smtp and smtp.email_address and smtp.email_password),
        "smtp_from": (smtp.email_address if smtp else None) or "learncode612000@gmail.com",
        "report_type": PROCESS_SETPOINT_REPORT_KEY,
        "groups": setpoint_groups,
        "recipient_count": len(recipients),
        "modules": list_modules(),
    }


@router.post("/groups")
def create_setpoint_group(
    data: SetpointGroupIn,
    db: Session = Depends(get_db),
    _=Depends(require_role("admin")),
):
    """Create an email group dedicated to process_setpoint_alerts (leaves OEE groups alone)."""
    name = (data.name or "").strip()
    if not name:
        raise HTTPException(400, "Group name is required")
    if db.query(EmailGroup).filter(EmailGroup.name == name).first():
        raise HTTPException(400, "Group name already exists")
    # Always stamp process_setpoint_alerts — do not overwrite classic report types on other groups
    g = EmailGroup(
        name=name,
        description=(data.description or "").strip() or "Process setpoint / LSL·USL alerts",
        report_types=PROCESS_SETPOINT_REPORT_KEY,
    )
    db.add(g)
    db.commit()
    db.refresh(g)
    return {
        "id": g.id,
        "name": g.name,
        "description": g.description,
        "report_types": g.report_types,
        "count": 0,
        "members": [],
    }


@router.post("/recipients")
def add_setpoint_recipient(
    data: SetpointRecipientIn,
    db: Session = Depends(get_db),
    _=Depends(require_role("admin")),
):
    g = db.query(EmailGroup).filter(EmailGroup.id == data.group_id).first()
    if not g:
        raise HTTPException(404, "Group not found")
    rts = {r.strip() for r in (g.report_types or "").split(",") if r.strip()}
    if PROCESS_SETPOINT_REPORT_KEY not in rts:
        raise HTTPException(400, "Group is not a Process Setpoint Alerts group")
    email = (data.email or "").strip().lower()
    if not email or "@" not in email:
        raise HTTPException(400, "Valid email required")
    r = EmailRecipient(
        group_id=g.id,
        name=(data.name or "").strip() or email.split("@")[0],
        email=email,
        active=1 if data.active else 0,
    )
    db.add(r)
    db.commit()
    db.refresh(r)
    return {"id": r.id, "name": r.name, "email": r.email, "active": r.active, "group_id": g.id}


@router.delete("/groups/{gid}")
def delete_setpoint_group(
    gid: int,
    db: Session = Depends(get_db),
    _=Depends(require_role("admin")),
):
    g = db.query(EmailGroup).filter(EmailGroup.id == gid).first()
    if not g:
        raise HTTPException(404, "Not found")
    rts = {r.strip() for r in (g.report_types or "").split(",") if r.strip()}
    if PROCESS_SETPOINT_REPORT_KEY not in rts:
        raise HTTPException(400, "Refusing to delete a non-setpoint group from this module")
    db.query(EmailRecipient).filter(EmailRecipient.group_id == gid).delete()
    db.delete(g)
    db.commit()
    return {"ok": True}


@router.get("/resolve/{machine_id}")
def resolve_for_machine(
    machine_id: int,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    m = db.query(Machine).filter(Machine.id == machine_id).first()
    if not m:
        raise HTTPException(404, "Machine not found")
    mtype = getattr(m, "machine_type", None) or getattr(m, "type", None) or ""
    # Infer profile from type for UI guidance
    profile = "generic_plc"
    mt = str(mtype).lower()
    if "servo" in mt and "press" in mt:
        profile = "servo_press"
    elif "linear" in mt:
        profile = "linear_motor"
    elif "spm" in mt and "ah" not in mt:
        profile = "spm"
    mod = resolve_module(profile_id=profile, machine_type=str(mtype), machine_name=str(m.name or ""))
    return {
        "machine_id": machine_id,
        "machine_name": m.name,
        "machine_type": mtype,
        "profile_id": profile,
        "module": mod.describe() if mod else None,
    }
