from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from typing import Optional, List
from pydantic import BaseModel
from pathlib import Path
import shutil, uuid
from datetime import datetime
from ..models import Machine, Station, BreakdownTicket, ProductionPlan, ModelChangeRequest, MachineStatusLog, get_db, now_ist
from ..auth import get_current_user, require_role
from ..upload_limits import MAX_IMAGE_BYTES, save_upload_limited
from ..ws_manager import manager

router = APIRouter(prefix="/api/machines", tags=["machines"])

UPLOAD_DIR = Path(__file__).parent.parent.parent / "static" / "machines"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


class MachineCreate(BaseModel):
    name: str
    station_id: int
    machine_type: Optional[str] = "CNC"
    make: Optional[str] = None
    model_no: Optional[str] = None
    tonnage: Optional[str] = None
    features: Optional[str] = None
    location: Optional[str] = None
    plc_source: Optional[str] = "manual"
    plc_endpoint: Optional[str] = None
    plc_topic: Optional[str] = None


class MachineUpdate(MachineCreate):
    pass


class StatusPush(BaseModel):
    status: str
    source: Optional[str] = "api"


def _compute_status(machine: Machine, db: Session) -> str:
    """Priority: offline > breakdown > alarm > setting_change > PLC status (running/idle) > plan-derived running > idle"""
    # 1. Offline — highest priority
    if machine.status == "offline":
        return "offline"

    # 2. Active breakdown ticket → breakdown
    active_bd = db.query(BreakdownTicket).filter(
        BreakdownTicket.machine_id == machine.id,
        BreakdownTicket.status.in_(["raised", "acknowledged", "in_progress"])
    ).first()
    if active_bd:
        return "breakdown"

    # 3. PLC alarm
    if machine.status == "alarm":
        return "alarm"

    # 4. Active model change request → setting_change
    active_mc = db.query(ModelChangeRequest).filter(
        ModelChangeRequest.machine_id == machine.id,
        ModelChangeRequest.status.in_(["approved", "in_progress"])
    ).first()
    if active_mc:
        return "setting_change"

    # 5. Trust PLC-pushed running/idle directly — PLC is ground truth
    if machine.status in ("running", "idle"):
        return machine.status

    return "idle"


def _log_status(machine_id: int, status: str, source: str, db: Session):
    entry = MachineStatusLog(
        machine_id=machine_id,
        status=status,
        changed_at=now_ist(),
        source=source,
    )
    db.add(entry)
    db.flush()
    try:
        from ..deviation_alert_service import on_status_logged, on_immediate_status_event
        on_status_logged(db, machine_id, entry)
        on_immediate_status_event(db, machine_id, status, source)
    except Exception as exc:
        print(f"[DeviationAlert] status hook failed: {exc}")
    return entry

class ReasonUpdate(BaseModel):
    reason: str

@router.patch("/status-log/{log_id}/reason")
def update_reason(log_id: int, data: ReasonUpdate, db: Session = Depends(get_db), _=Depends(get_current_user)):
    log = db.query(MachineStatusLog).filter(MachineStatusLog.id == log_id).first()
    if not log:
        raise HTTPException(404, "Log entry not found")
    log.deviation_reason = data.reason
    db.commit()
    try:
        from ..deviation_alert_service import resolve_escalation_for_segment
        resolve_escalation_for_segment(db, log_id, 'deviation_reason_recorded')
    except Exception as exc:
        print(f"[DeviationAlert] resolve on reason failed: {exc}")
    return {"ok": True}

@router.get("/")
def list_machines(db: Session = Depends(get_db), _=Depends(get_current_user)):
    machines = db.query(Machine).order_by(Machine.station_id, Machine.id).all()
    result = []
    for m in machines:
        live_status = _compute_status(m, db)
        if m.status != live_status:
            m.status = live_status
            _log_status(m.id, live_status, "sync", db)
        station = db.query(Station).filter(Station.id == m.station_id).first()
        result.append({
            "id": m.id,
            "name": m.name,
            "station_id": m.station_id,
            "station_name": station.display_name if station else "Unknown",
            "machine_type": m.machine_type,
            "make": m.make,
            "model_no": m.model_no,
            "tonnage": m.tonnage,
            "features": m.features,
            "location": m.location,
            "image_url": m.image_url,
            "status": live_status,
        })
    db.commit()
    return result


@router.get("/station-numbers")
def get_station_numbers(db: Session = Depends(get_db), _=Depends(get_current_user)):
    """Returns all stations available."""
    stations = db.query(Station).order_by(Station.id).all()
    return [{"id": s.id, "name": s.display_name} for s in stations]


@router.get("/fleet")
def get_fleet(db: Session = Depends(get_db), _=Depends(get_current_user)):
    """Returns all machines with live computed status grouped by station."""
    machines = db.query(Machine).order_by(Machine.station_id, Machine.id).all()
    result = []
    for m in machines:
        live_status = _compute_status(m, db)
        station = db.query(Station).filter(Station.id == m.station_id).first()
        result.append({
            "id": m.id, "name": m.name, "station_id": m.station_id,
            "station_name": station.display_name if station else "Unknown",
            "machine_type": m.machine_type, "make": m.make,
            "model_no": m.model_no, "tonnage": m.tonnage,
            "features": m.features, "location": m.location,
            "image_url": m.image_url, "plc_source": m.plc_source,
            "plc_endpoint": m.plc_endpoint, "plc_topic": m.plc_topic,
            "status": live_status,
        })
    return result


@router.post("/")
async def create_machine(data: MachineCreate, db: Session = Depends(get_db),
                         user=Depends(require_role("admin"))):
    # Validate pair exists
    station = db.query(Station).filter(Station.id == data.station_id).first()
    if not station:
        raise HTTPException(404, f"Station with id {data.station_id} not found")
    
    m = Machine(**data.dict())
    db.add(m)
    db.commit()
    db.refresh(m)
    await manager.broadcast({"type": "machine_created", "id": m.id})
    return m


@router.put("/{machine_id}")
async def update_machine(machine_id: int, data: MachineUpdate,
                         db: Session = Depends(get_db),
                         user=Depends(require_role("admin"))):
    m = db.query(Machine).filter(Machine.id == machine_id).first()
    if not m:
        raise HTTPException(404, "Machine not found")
    
    # If station_id is being changed, validate it exists
    if "station_id" in data.dict(exclude_unset=True):
        station = db.query(Station).filter(Station.id == data.station_id).first()
        if not station:
            raise HTTPException(404, f"Station with id {data.station_id} not found")
    
    for k, v in data.dict(exclude_unset=True).items():
        setattr(m, k, v)
    db.commit()
    db.refresh(m)
    await manager.broadcast({"type": "machine_updated", "id": m.id})
    return m


@router.delete("/{machine_id}")
async def delete_machine(machine_id: int, db: Session = Depends(get_db),
                         user=Depends(require_role("admin"))):
    m = db.query(Machine).filter(Machine.id == machine_id).first()
    if not m:
        raise HTTPException(404, "Machine not found")
    db.delete(m)
    db.commit()
    await manager.broadcast({"type": "machine_deleted", "id": machine_id})
    return {"ok": True}


@router.post("/{machine_id}/image")
async def upload_image(machine_id: int, file: UploadFile = File(...),
                       db: Session = Depends(get_db),
                       user=Depends(require_role("admin"))):
    m = db.query(Machine).filter(Machine.id == machine_id).first()
    if not m:
        raise HTTPException(404, "Machine not found")
    ext = Path(file.filename).suffix
    fname = f"machine_{machine_id}_{uuid.uuid4().hex[:8]}{ext}"
    fpath = UPLOAD_DIR / fname
    await save_upload_limited(file, fpath, MAX_IMAGE_BYTES)
    m.image_url = f"/static/machines/{fname}"
    db.commit()
    return {"image_url": m.image_url}


@router.patch("/{machine_id}/status")
async def push_status(machine_id: int, data: StatusPush,
                      db: Session = Depends(get_db)):
    """External PLC/API push — called by Node-RED, MQTT bridge, Modbus bridge."""
    allowed = {"running", "idle", "breakdown", "setting_change", "alarm", "offline"}
    if data.status not in allowed:
        raise HTTPException(400, f"status must be one of {allowed}")
    m = db.query(Machine).filter(Machine.id == machine_id).first()
    if not m:
        raise HTTPException(404, "Machine not found")
    # Operator breakdown ticket takes priority — don't override with PLC idle/running
    if data.status in ("idle", "running"):
        active_bd = db.query(BreakdownTicket).filter(
            BreakdownTicket.machine_id == machine_id,
            BreakdownTicket.status.in_(["raised", "acknowledged", "in_progress"])
        ).first()
        if active_bd:
            return {"id": machine_id, "status": m.status, "source": data.source, "note": "breakdown ticket active"}
        # Active model-change (setting change in progress) takes priority — don't override
        active_mc = db.query(ModelChangeRequest).filter(
            ModelChangeRequest.machine_id == machine_id,
            ModelChangeRequest.status.in_(["approved", "in_progress"]),
        ).first()
        if active_mc:
            return {"id": machine_id, "status": m.status, "source": data.source, "note": "setting change active"}
    if m.status == data.status:
        return {"id": machine_id, "status": m.status, "source": data.source, "note": "no change"}
    m.status = data.status
    _log_status(machine_id, data.status, data.source or "api", db)
    db.commit()
    await manager.broadcast({
        "type": "machine_status_updated",
        "id": machine_id, "status": data.status, "source": data.source
    })
    return {"id": machine_id, "status": data.status, "source": data.source}


@router.get("/{machine_id}/status-log")
def get_status_log(
    machine_id: int,
    limit: int = 500,
    date_from: str = None,
    date_to: str = None,
    stitch: bool = False,
    model_variant: str = None,
    db: Session = Depends(get_db),
    _=Depends(get_current_user)
):
    from datetime import datetime as dt
    q = db.query(MachineStatusLog).filter(MachineStatusLog.machine_id == machine_id)
    if date_from:
        try:
            q = q.filter(MachineStatusLog.changed_at >= dt.fromisoformat(date_from))
        except ValueError:
            pass
    if date_to:
        try:
            from datetime import timedelta as _td
            q = q.filter(MachineStatusLog.changed_at < dt.fromisoformat(date_to) + _td(days=1))
        except ValueError:
            pass
    logs = q.order_by(MachineStatusLog.changed_at.desc()).limit(limit).all()
    result = []
    for i, l in enumerate(logs):
        result.append({
            "id": l.id, "status": l.status,
            "changed_at": l.changed_at.strftime('%Y-%m-%dT%H:%M:%S'),
            "end_time": logs[i - 1].changed_at.strftime('%Y-%m-%dT%H:%M:%S') if i > 0 else None,
            "source": l.source,
            "deviation_reason": l.deviation_reason or "",
        })

    if stitch and model_variant:
        try:
            from ..models import Part
            import json as _json
            part = db.query(Part).filter(
                (Part.part_no == model_variant) | (Part.model_variant == model_variant),
                Part.active == 1,
            ).first()
            if part and getattr(part, 'cycle_profile_json', None):
                profile = _json.loads(part.cycle_profile_json)
                # Only stitch when interruptions > 0 is explicitly configured
                if isinstance(profile, dict) and int(profile.get('interruptions') or 0) > 0:
                    from ..cycle_stitcher import stitch_cycles
                    result = stitch_cycles(result, profile)
                    for row in result:
                        row.pop('_consumed', None)
        except Exception as exc:
            print(f"[CycleStitcher] error: {exc}")

    return result


@router.get("/{machine_id}")
def get_machine(machine_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    m = db.query(Machine).filter(Machine.id == machine_id).first()
    if not m:
        raise HTTPException(404, "Machine not found")
    return m
