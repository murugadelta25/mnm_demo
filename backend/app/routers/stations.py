from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from ..models import Station, Machine, get_db
from ..auth import get_current_user, require_role
from ..ws_manager import manager

router = APIRouter(prefix="/api/stations", tags=["stations"])


def _station_enabled(s: Station) -> bool:
    return int(getattr(s, "is_enabled", 1) or 0) != 0


class StationCreate(BaseModel):
    name: str
    display_name: str
    is_enabled: Optional[int] = 1


class StationUpdate(BaseModel):
    display_name: Optional[str] = None
    is_enabled: Optional[int] = None


class StationEnabledBody(BaseModel):
    is_enabled: bool = True


@router.get("/")
def list_stations(
    enabled_only: bool = Query(False, description="When true, omit soft-disabled stations"),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    stations = db.query(Station).order_by(Station.id).all()
    result = []
    for s in stations:
        enabled = _station_enabled(s)
        if enabled_only and not enabled:
            continue
        machine_count = db.query(Machine).filter(Machine.station_id == s.id).count()
        result.append({
            "id": s.id,
            "name": s.name,
            "display_name": s.display_name,
            "machine_count": machine_count,
            "is_enabled": enabled,
        })
    return result


@router.post("/")
async def create_station(data: StationCreate, db: Session = Depends(get_db),
                         user=Depends(require_role("admin"))):
    existing = db.query(Station).filter(Station.name == data.name).first()
    if existing:
        raise HTTPException(400, f"Station name '{data.name}' already exists")

    s = Station(
        name=data.name,
        display_name=data.display_name,
        is_enabled=1 if data.is_enabled is None or int(data.is_enabled) else 0,
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    await manager.broadcast({"type": "station_created", "id": s.id})
    return {
        "id": s.id,
        "name": s.name,
        "display_name": s.display_name,
        "is_enabled": _station_enabled(s),
    }


@router.put("/{station_id}")
async def update_station(station_id: int, data: StationUpdate,
                         db: Session = Depends(get_db),
                         user=Depends(require_role("admin"))):
    s = db.query(Station).filter(Station.id == station_id).first()
    if not s:
        raise HTTPException(404, "Station not found")

    payload = data.dict(exclude_unset=True)
    if "display_name" in payload and payload["display_name"] is not None:
        s.display_name = payload["display_name"]
    if "is_enabled" in payload and payload["is_enabled"] is not None:
        s.is_enabled = 1 if int(payload["is_enabled"]) else 0
    db.commit()
    db.refresh(s)
    await manager.broadcast({"type": "station_updated", "id": s.id})
    return {
        "id": s.id,
        "name": s.name,
        "display_name": s.display_name,
        "is_enabled": _station_enabled(s),
    }


@router.post("/{station_id}/enabled")
async def set_station_enabled(
    station_id: int,
    data: StationEnabledBody,
    db: Session = Depends(get_db),
    user=Depends(require_role("admin")),
):
    s = db.query(Station).filter(Station.id == station_id).first()
    if not s:
        raise HTTPException(404, "Station not found")
    s.is_enabled = 1 if data.is_enabled else 0
    db.commit()
    db.refresh(s)
    await manager.broadcast({"type": "station_updated", "id": s.id, "is_enabled": bool(s.is_enabled)})
    return {"id": s.id, "is_enabled": _station_enabled(s)}


@router.delete("/{station_id}")
async def delete_station(station_id: int, db: Session = Depends(get_db),
                         user=Depends(require_role("admin"))):
    s = db.query(Station).filter(Station.id == station_id).first()
    if not s:
        raise HTTPException(404, "Station not found")

    machine_count = db.query(Machine).filter(Machine.station_id == station_id).count()
    if machine_count > 0:
        raise HTTPException(
            400,
            f"Cannot delete station with {machine_count} machine(s) assigned. Reassign machines first."
        )

    db.delete(s)
    db.commit()
    await manager.broadcast({"type": "station_deleted", "id": station_id})
    return {"ok": True}


@router.get("/{station_id}/machines")
def get_station_machines(station_id: int, db: Session = Depends(get_db),
                         _=Depends(get_current_user)):
    s = db.query(Station).filter(Station.id == station_id).first()
    if not s:
        raise HTTPException(404, "Station not found")

    machines = db.query(Machine).filter(Machine.station_id == station_id).order_by(Machine.id).all()
    return [
        {
            "id": m.id,
            "name": m.name,
            "machine_type": m.machine_type,
            "make": m.make,
            "model_no": m.model_no,
            "status": m.status,
            "is_enabled": int(getattr(m, "is_enabled", 1) or 0) != 0,
        }
        for m in machines
    ]
