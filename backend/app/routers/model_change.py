from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime, date, timezone
import pytz

IST = pytz.timezone('Asia/Kolkata')
def now_ist(): return datetime.now(IST).replace(tzinfo=None)
from pydantic import BaseModel
from typing import Optional
from ..models import ModelChangeRequest, Machine, get_db
from ..auth import get_current_user, require_role
from ..ws_manager import manager

router = APIRouter(prefix="/api/model-change", tags=["model-change"])

class MCRCreate(BaseModel):
    machine_id: int
    from_model: str
    to_model: str
    ideal_minutes: int = 60
    shift: str = "A"
    entry_date: Optional[date] = None
    reason: str = "setting_change"

@router.post("/")
async def request_model_change(data: MCRCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    mcr = ModelChangeRequest(
        machine_id=data.machine_id, requested_by=user.id,
        from_model=data.from_model, to_model=data.to_model,
        ideal_minutes=data.ideal_minutes,
        shift=data.shift,
        entry_date=data.entry_date or now_ist().date(),
        reason=data.reason,
        created_at=now_ist()
    )
    db.add(mcr)
    db.commit()
    db.refresh(mcr)
    await manager.broadcast({"type": "model_change_request", "id": mcr.id, "machine_id": data.machine_id,
                              "from_model": data.from_model, "to_model": data.to_model, "status": "pending"})
    return _enrich(mcr, db)

@router.patch("/{mcr_id}/approve")
async def approve_request(mcr_id: int, db: Session = Depends(get_db), user=Depends(require_role("supervisor", "admin"))):
    mcr = db.query(ModelChangeRequest).filter(ModelChangeRequest.id == mcr_id).first()
    if not mcr: raise HTTPException(404, "Not found")
    mcr.status = "approved"
    mcr.approved_by = user.id
    mcr.start_time = now_ist()
    machine = db.query(Machine).filter(Machine.id == mcr.machine_id).first()
    if machine: machine.status = "setting_change"
    db.commit()
    await manager.broadcast({"type": "model_change_approved", "id": mcr_id, "machine_id": mcr.machine_id,
                              "start_time": mcr.start_time.isoformat(), "ideal_minutes": mcr.ideal_minutes})
    return _enrich(mcr, db)

@router.patch("/{mcr_id}/complete")
async def complete_request(mcr_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    mcr = db.query(ModelChangeRequest).filter(ModelChangeRequest.id == mcr_id).first()
    if not mcr: raise HTTPException(404, "Not found")
    mcr.status = "completed"
    mcr.end_time = now_ist()
    machine = db.query(Machine).filter(Machine.id == mcr.machine_id).first()
    if machine: machine.status = "running"
    db.commit()
    elapsed = int((mcr.end_time - mcr.start_time).total_seconds() / 60) if mcr.start_time else 0
    await manager.broadcast({"type": "model_change_completed", "id": mcr_id, "machine_id": mcr.machine_id,
                              "elapsed_minutes": elapsed, "ideal_minutes": mcr.ideal_minutes})
    return _enrich(mcr, db)

@router.patch("/{mcr_id}/reject")
async def reject_request(mcr_id: int, db: Session = Depends(get_db), user=Depends(require_role("supervisor", "admin"))):
    mcr = db.query(ModelChangeRequest).filter(ModelChangeRequest.id == mcr_id).first()
    if not mcr: raise HTTPException(404, "Not found")
    mcr.status = "rejected"
    db.commit()
    await manager.broadcast({"type": "model_change_rejected", "id": mcr_id, "machine_id": mcr.machine_id})
    return _enrich(mcr, db)

@router.get("/")
def get_requests(db: Session = Depends(get_db), _=Depends(get_current_user)):
    mcrs = db.query(ModelChangeRequest).order_by(ModelChangeRequest.created_at.desc()).all()
    return [_enrich(m, db) for m in mcrs]

@router.get("/approved")
def get_approved(entry_date: str, shift: str, station_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    """Return total ideal_minutes for approved/completed model changes for a given date+shift+pair."""
    machines = db.query(Machine).filter(Machine.station_id == station_id).all()
    machine_ids = [m.id for m in machines]
    if not machine_ids:
        return {"total_minutes": 0, "requests": []}
    mcrs = db.query(ModelChangeRequest).filter(
        ModelChangeRequest.entry_date == entry_date,
        ModelChangeRequest.shift == shift,
        ModelChangeRequest.machine_id.in_(machine_ids),
        ModelChangeRequest.status.in_(["approved", "completed"])
    ).all()
    total = sum(m.ideal_minutes for m in mcrs)
    return {"total_minutes": total, "requests": [_enrich(m, db) for m in mcrs]}

def _enrich(mcr, db):
    machine = db.query(Machine).filter(Machine.id == mcr.machine_id).first()
    d = {c.name: getattr(mcr, c.name) for c in mcr.__table__.columns}
    d["machine_name"] = machine.name if machine else str(mcr.machine_id)
    d["station_id"] = machine.station_id if machine else None
    return d
