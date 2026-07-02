from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from ..models import BreakdownTicket, Machine, ProductionPlan, MachineStatusLog, get_db, now_ist
from ..auth import get_current_user, require_role
from ..ws_manager import manager
from datetime import datetime

from .machines import _log_status

router = APIRouter(prefix="/api/breakdown", tags=["breakdown"])

class TicketCreate(BaseModel):
    machine_id: int
    raised_by: int
    description: str

class TicketResolve(BaseModel):
    resolution_notes: str

@router.post("/")
async def raise_ticket(data: TicketCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    ticket = BreakdownTicket(
        machine_id=data.machine_id, raised_by=data.raised_by,
        description=data.description, created_at=now_ist()
    )
    db.add(ticket)
    machine = db.query(Machine).filter(Machine.id == data.machine_id).first()
    if machine: machine.status = "breakdown"
    db.commit()
    db.refresh(ticket)
    _log_status(data.machine_id, "breakdown", "breakdown", db)
    db.commit()
    await manager.broadcast({"type": "breakdown_raised", "id": ticket.id, "machine_id": data.machine_id,
                              "description": data.description, "status": "raised"})
    return ticket

@router.patch("/{ticket_id}/acknowledge")
async def acknowledge_ticket(ticket_id: int, db: Session = Depends(get_db), user=Depends(require_role("maintenance", "admin", "supervisor"))):
    ticket = db.query(BreakdownTicket).filter(BreakdownTicket.id == ticket_id).first()
    if not ticket: raise HTTPException(404, "Not found")
    ticket.status = "acknowledged"
    ticket.acknowledged_by = user.id
    ticket.ack_time = now_ist()
    db.commit()
    try:
        from ..deviation_alert_service import resolve_escalation_for_machine
        resolve_escalation_for_machine(db, ticket.machine_id, 'breakdown_acknowledged')
    except Exception as exc:
        print(f"[DeviationAlert] resolve on acknowledge failed: {exc}")
    await manager.broadcast({"type": "breakdown_acknowledged", "id": ticket_id, "machine_id": ticket.machine_id})
    return ticket

@router.patch("/{ticket_id}/start")
async def start_troubleshoot(ticket_id: int, db: Session = Depends(get_db), user=Depends(require_role("maintenance", "admin", "supervisor"))):
    ticket = db.query(BreakdownTicket).filter(BreakdownTicket.id == ticket_id).first()
    if not ticket: raise HTTPException(404, "Not found")
    ticket.status = "in_progress"
    ticket.start_troubleshoot = now_ist()
    db.commit()
    await manager.broadcast({"type": "breakdown_in_progress", "id": ticket_id, "machine_id": ticket.machine_id})
    return ticket

@router.patch("/{ticket_id}/resolve")
async def resolve_ticket(ticket_id: int, data: TicketResolve, db: Session = Depends(get_db), user=Depends(require_role("maintenance", "admin", "supervisor"))):
    ticket = db.query(BreakdownTicket).filter(BreakdownTicket.id == ticket_id).first()
    if not ticket: raise HTTPException(404, "Not found")
    ticket.status = "resolved"
    ticket.resolved_time = now_ist()
    ticket.resolution_notes = data.resolution_notes
    machine = db.query(Machine).filter(Machine.id == ticket.machine_id).first()
    if machine:
        from .machines import _compute_status
        machine.status = _compute_status(machine, db)
        _log_status(ticket.machine_id, machine.status, "breakdown_resolved", db)
    db.commit()
    await manager.broadcast({"type": "breakdown_resolved", "id": ticket_id,
                              "machine_id": ticket.machine_id, "status": machine.status if machine else "idle"})
    return ticket

@router.get("/users")
def get_users(db: Session = Depends(get_db), _=Depends(get_current_user)):
    from ..models import User
    return [{"id": u.id, "username": u.username, "role": u.role}
            for u in db.query(User)
                       .filter(User.role.in_(["operator", "supervisor"]))
                       .order_by(User.role, User.username).all()]

@router.get("/")
def get_tickets(db: Session = Depends(get_db), _=Depends(get_current_user)):
    from ..models import User
    tickets = db.query(BreakdownTicket).order_by(BreakdownTicket.created_at.desc()).all()
    users = {u.id: u.username for u in db.query(User).all()}
    result = []
    for tk in tickets:
        d = {c.name: getattr(tk, c.name) for c in tk.__table__.columns}
        d["raised_by_username"] = users.get(tk.raised_by, str(tk.raised_by) if tk.raised_by else "")
        d["acknowledged_by_username"] = users.get(tk.acknowledged_by, str(tk.acknowledged_by) if tk.acknowledged_by else "")
        result.append(d)
    return result

@router.get("/machines")
def get_machines(db: Session = Depends(get_db), _=Depends(get_current_user)):
    from .machines import _compute_status
    machines = db.query(Machine).order_by(Machine.station_id, Machine.id).all()
    result = []
    for m in machines:
        live = _compute_status(m, db)
        has_plan = db.query(ProductionPlan).filter(
            ProductionPlan.status == "running",
            (ProductionPlan.machine_id == m.id) |
            (ProductionPlan.station_no == m.station_id)
        ).first() is not None
        result.append({
            "id": m.id, "name": m.name, "station_id": m.station_id,
            "status": live, "machine_type": m.machine_type,
            "make": m.make, "model_no": m.model_no, "tonnage": m.tonnage,
            "features": m.features, "image_url": m.image_url, "location": m.location,
            "plc_source": m.plc_source, "has_plan": has_plan,
        })
    return result
