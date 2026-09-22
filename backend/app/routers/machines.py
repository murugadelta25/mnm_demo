from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from sqlalchemy.orm import Session
from typing import Optional, List, Any, Dict
from pydantic import BaseModel
from pathlib import Path
import shutil, uuid
from datetime import datetime, timedelta
from ..models import Machine, Station, BreakdownTicket, ProductionPlan, ModelChangeRequest, MachineStatusLog, get_db, now_ist
from ..auth import get_current_user, require_role
from ..upload_limits import MAX_IMAGE_BYTES, save_upload_limited
from ..ws_manager import manager

router = APIRouter(prefix="/api/machines", tags=["machines"])

UPLOAD_DIR = Path(__file__).parent.parent.parent / "static" / "machines"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# Cap live WS fan-out: Node-RED can POST many partials/sec; UI only needs ~2–3 Hz.
_TELEMETRY_WS_LAST: Dict[int, float] = {}
_TELEMETRY_WS_MIN_SEC = 0.4


def _should_broadcast_telemetry(machine_id: int, result: dict) -> bool:
    """Throttle routine ticks; always send when thresholds/email status change."""
    import time
    force = bool(
        result.get("email_alert_status")
        or (isinstance(result.get("threshold_breaches"), dict) and result.get("threshold_breaches"))
    )
    now = time.monotonic()
    if force:
        _TELEMETRY_WS_LAST[int(machine_id)] = now
        return True
    last = _TELEMETRY_WS_LAST.get(int(machine_id), 0.0)
    if (now - last) < _TELEMETRY_WS_MIN_SEC:
        return False
    _TELEMETRY_WS_LAST[int(machine_id)] = now
    return True


def _telemetry_ws_payload(machine_id: int, result: dict) -> dict:
    return {
        "type": "machine_telemetry_updated",
        "id": machine_id,
        "deviceName": result.get("device_name"),
        "syncBy": result.get("sync_by"),
        "telemetry": {
            "available": True,
            "updated_at": result.get("updated_at"),
            "sync_by": result.get("sync_by"),
            "device_name": result.get("device_name"),
            "device_uuid": result.get("device_uuid"),
            "origin": result.get("origin"),
            "digital_io": result.get("digital_io"),
            "scaled": result.get("scaled"),
            "raw": result.get("raw"),
            "param_rows": result.get("param_rows"),
            "current": result.get("current"),
            "current_tiles": result.get("current_tiles"),
            "production": result.get("production"),
            "shift_production": result.get("shift_production"),
            "status": result.get("status"),
            "pressing_result": result.get("pressing_result"),
            "screw_driver": result.get("screw_driver"),
            "result_ready": result.get("result_ready"),
            "io_status": result.get("io_status"),
            "profile": result.get("profile"),
            "registers": result.get("registers"),
            "thresholds": result.get("thresholds"),
            "threshold_breaches": result.get("threshold_breaches"),
            "alarms": result.get("alarms"),
            "trend": result.get("trend"),
            "email_alert_status": result.get("email_alert_status"),
            "modbus_kpi": result.get("modbus_kpi"),
            "telemetry_module": result.get("telemetry_module"),
        },
    }


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
    is_enabled: Optional[int] = 1


class MachineUpdate(BaseModel):
    name: Optional[str] = None
    station_id: Optional[int] = None
    machine_type: Optional[str] = None
    make: Optional[str] = None
    model_no: Optional[str] = None
    tonnage: Optional[str] = None
    features: Optional[str] = None
    location: Optional[str] = None
    plc_source: Optional[str] = None
    plc_endpoint: Optional[str] = None
    plc_topic: Optional[str] = None
    is_enabled: Optional[int] = None


class MachineEnabledBody(BaseModel):
    is_enabled: bool = True


def _machine_enabled(m: Machine) -> bool:
    return int(getattr(m, "is_enabled", 1) or 0) != 0


class StatusPush(BaseModel):
    status: str
    source: Optional[str] = "api"


class TelemetryReading(BaseModel):
    name: Optional[str] = None
    value: Optional[Any] = None
    origin: Optional[Any] = None


class NodeRedTelemetryPush(BaseModel):
    """Node-RED Modbus sync payload (deviceName + readings[{name,value}])."""
    id: Optional[str] = None
    syncBy: Optional[str] = None
    deviceName: Optional[str] = None
    device: Optional[str] = None
    origin: Optional[Any] = None
    readings: Optional[List[TelemetryReading]] = None
    machine_id: Optional[int] = None
    # Live Edge snapshots: replace sticky merge instead of merging with prior sim/partial tags
    replaceReadings: Optional[bool] = None
    replace_readings: Optional[bool] = None
    # One-shot: wipe alarm/history/trend/runtime residue left by a previous simulator
    resetLog: Optional[bool] = None
    reset_log: Optional[bool] = None


class CncLivePush(BaseModel):
    """
    Node-RED → CNC live tags (Delta NC510 / Edge LO). Separate from Servo Press /telemetry.
    Pass the raw LO tags array as `tags`, plus machine_id (or use /{machine_id}/cnc-live).
    """
    tags: Optional[List[Any]] = None
    machine_id: Optional[int] = None
    device_id: Optional[int] = None
    deviceId: Optional[int] = None
    device_name: Optional[str] = None
    deviceName: Optional[str] = None
    source: Optional[str] = "nodered"


def _compute_status(machine: Machine, db: Session) -> str:
    """Priority: offline > breakdown > alarm > setting_change > open operator loss > PLC status (running/idle) > idle"""
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

    # 5. Open timed loss from tablet — only when mobile integration is enabled
    try:
        from ..mobile_integration import is_mobile_integration_enabled
        if not is_mobile_integration_enabled(db):
            pass  # fall through to PLC / idle
        else:
            from ..models import OperatorLossLog
            from ..loss_mapping import map_loss_to_oee
            from datetime import timedelta as _td
            open_loss = (
                db.query(OperatorLossLog)
                .filter(
                    OperatorLossLog.machine_id == machine.id,
                    OperatorLossLog.status == "open",
                )
                .order_by(OperatorLossLog.started_at.desc())
                .first()
            )
            if open_loss:
                # Abandoned open losses must not freeze web Loss Tracker / PLC forever
                started = open_loss.started_at
                if started and (now_ist() - started) > _td(hours=12):
                    open_loss.status = "closed"
                    open_loss.ended_at = now_ist()
                    if open_loss.minutes is None or float(open_loss.minutes or 0) <= 0:
                        open_loss.minutes = round((now_ist() - started).total_seconds() / 60.0, 2)
                    open_loss.notes = ((open_loss.notes or "") + " [auto-closed: stale open session]").strip()
                    # Persist immediately — many callers of _compute_status are read-only
                    # and never commit (unlike push_status, which already commits here).
                    try:
                        db.commit()
                    except Exception:
                        db.rollback()
                else:
                    _field, _bucket, loss_status = map_loss_to_oee(
                        open_loss.loss_code, open_loss.sub_division
                    )
                    if loss_status:
                        return loss_status
    except Exception:
        pass

    # 6. Trust PLC-pushed running/idle directly — PLC is ground truth
    if machine.status in ("running", "idle"):
        return machine.status

    return "idle"


def _log_status(machine_id: int, status: str, source: str, db: Session,
                deviation_reason: str = None):
    entry = MachineStatusLog(
        machine_id=machine_id,
        status=status,
        changed_at=now_ist(),
        source=source,
        deviation_reason=(deviation_reason or None),
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


def _resolve_shift_at_ts(ts: datetime, cfg: dict):
    """Resolve shift id and logical entry_date for a timestamp."""
    from .hourly_output import _parse_mins

    shifts = [s for s in (cfg.get("shifts") or []) if s.get("enabled", True)]
    if not shifts:
        shifts = [
            {"id": "A", "start": "08:00", "end": "20:00", "enabled": True},
            {"id": "B", "start": "20:00", "end": "08:00", "enabled": True},
        ]

    hhmm = ts.hour * 60 + ts.minute
    for sh in shifts:
        start_m = _parse_mins(sh.get("start", "08:00"))
        end_m = _parse_mins(sh.get("end", "20:00"))
        overnight = end_m <= start_m
        in_shift = (
            (not overnight and start_m <= hhmm < end_m)
            or (overnight and (hhmm >= start_m or hhmm < end_m))
        )
        if not in_shift:
            continue
        entry_date = ts.date()
        if overnight and hhmm < end_m:
            entry_date = entry_date - timedelta(days=1)
        return sh.get("id", "A"), entry_date

    first = shifts[0]
    return first.get("id", "A"), ts.date()


def _pick_plan_for_segment(db: Session, machine_id: int, changed_at: datetime, cfg: dict):
    """Pick the best matching production plan for one status segment."""
    shift_id, entry_date = _resolve_shift_at_ts(changed_at, cfg)
    plans = db.query(ProductionPlan).filter(
        ProductionPlan.machine_id == machine_id,
        ProductionPlan.plan_date == entry_date,
        ProductionPlan.shift == shift_id,
        ProductionPlan.status.in_(["running", "completed", "pending", "paused"]),
    ).order_by(ProductionPlan.priority, ProductionPlan.id).all()
    if not plans:
        return None
    status_rank = {"running": 0, "completed": 1, "pending": 2, "paused": 3}
    plans.sort(key=lambda p: (status_rank.get(p.status, 9), p.priority or 9999, p.id))
    return plans[0]

class ReasonUpdate(BaseModel):
    reason: str
    loss_code: Optional[str] = None
    loss_description: Optional[str] = None
    sub_division: Optional[str] = None
    create_loss_log: bool = False  # opt-in; default keeps web manual reason independent of mobile rollup


@router.patch("/status-log/{log_id}/reason")
def update_reason(log_id: int, data: ReasonUpdate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    log = db.query(MachineStatusLog).filter(MachineStatusLog.id == log_id).first()
    if not log:
        raise HTTPException(404, "Log entry not found")
    log.deviation_reason = data.reason

    # Optional: create OperatorLossLog so Data Entry / availability picks up the minutes
    loss_id = None
    if data.create_loss_log and data.loss_code:
        try:
            from ..mobile_integration import is_mobile_integration_enabled
            if not is_mobile_integration_enabled(db):
                raise RuntimeError("mobile integration off")
            from ..models import OperatorLossLog
            from ..loss_mapping import map_loss_to_oee

            nxt = (
                db.query(MachineStatusLog)
                .filter(
                    MachineStatusLog.machine_id == log.machine_id,
                    MachineStatusLog.changed_at > log.changed_at,
                )
                .order_by(MachineStatusLog.changed_at.asc())
                .first()
            )
            end_at = nxt.changed_at if nxt else now_ist()
            mins = max(0.1, round((end_at - log.changed_at).total_seconds() / 60.0, 2))
            oee_field, oee_bucket, _st = map_loss_to_oee(data.loss_code, data.sub_division)
            desc = data.loss_description or data.reason
            row = OperatorLossLog(
                machine_id=log.machine_id,
                operator_id=None,
                user_id=getattr(user, "id", None) if not getattr(user, "is_operator_principal", False) else None,
                username=getattr(user, "username", None) or getattr(user, "employee_code", None),
                loss_code=data.loss_code,
                loss_description=desc[:100],
                sub_division=data.sub_division,
                minutes=mins,
                notes=f"Assigned from Loss Tracker status-log #{log.id}",
                entry_date=log.changed_at.date() if log.changed_at else now_ist().date(),
                shift=None,
                status="closed",
                started_at=log.changed_at,
                ended_at=end_at,
                oee_field=oee_field,
                oee_bucket=oee_bucket,
                exclude_from_oee=0,
                created_at=now_ist(),
            )
            db.add(row)
            db.flush()
            loss_id = row.id
        except Exception as exc:
            print(f"[ReasonUpdate] loss log create skipped: {exc}")

    db.commit()
    try:
        from ..deviation_alert_service import resolve_escalation_for_segment
        resolve_escalation_for_segment(db, log_id, 'deviation_reason_recorded')
    except Exception as exc:
        print(f"[DeviationAlert] resolve on reason failed: {exc}")
    return {"ok": True, "loss_log_id": loss_id}


@router.get("/")
def list_machines(
    enabled_only: bool = False,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    from ..operator_presence import get_live_operator_map, operator_fields_for_machine

    try:
        machines = db.query(Machine).order_by(Machine.station_id, Machine.id).all()
    except Exception as exc:
        db.rollback()
        print(f"[ERROR] list_machines query failed: {exc}")
        raise HTTPException(500, f"Failed to load machines: {exc}")

    op_map = get_live_operator_map(db)
    result = []
    for m in machines:
        enabled = _machine_enabled(m)
        if enabled_only and not enabled:
            continue
        try:
            live_status = _compute_status(m, db)
            if m.status != live_status:
                m.status = live_status
                _log_status(m.id, live_status, "sync", db)
        except Exception as exc:
            print(f"[WARN] status compute failed for machine {m.id}: {exc}")
            live_status = m.status or "idle"
        station = db.query(Station).filter(Station.id == m.station_id).first()
        row = {
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
            "is_enabled": enabled,
        }
        row.update(operator_fields_for_machine(op_map, m.id))
        result.append(row)
    try:
        db.commit()
    except Exception:
        db.rollback()
    return result


@router.get("/station-numbers")
def get_station_numbers(
    enabled_only: bool = True,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """Returns stations available for operational selectors (enabled by default)."""
    stations = db.query(Station).order_by(Station.id).all()
    out = []
    for s in stations:
        if enabled_only and int(getattr(s, "is_enabled", 1) or 0) == 0:
            continue
        out.append({"id": s.id, "name": s.display_name, "is_enabled": int(getattr(s, "is_enabled", 1) or 0) != 0})
    return out


@router.get("/fleet")
def get_fleet(
    enabled_only: bool = False,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """Returns all machines with live computed status grouped by station."""
    from ..operator_presence import get_live_operator_map, operator_fields_for_machine

    machines = db.query(Machine).order_by(Machine.station_id, Machine.id).all()
    op_map = get_live_operator_map(db)
    result = []
    for m in machines:
        enabled = _machine_enabled(m)
        if enabled_only and not enabled:
            continue
        live_status = _compute_status(m, db)
        station = db.query(Station).filter(Station.id == m.station_id).first()
        row = {
            "id": m.id, "name": m.name, "station_id": m.station_id,
            "station_name": station.display_name if station else "Unknown",
            "machine_type": m.machine_type, "make": m.make,
            "model_no": m.model_no, "tonnage": m.tonnage,
            "features": m.features, "location": m.location,
            "image_url": m.image_url, "plc_source": m.plc_source,
            "plc_endpoint": m.plc_endpoint, "plc_topic": m.plc_topic,
            "status": live_status,
            "is_enabled": enabled,
        }
        row.update(operator_fields_for_machine(op_map, m.id))
        result.append(row)
    return result


@router.post("/")
async def create_machine(data: MachineCreate, db: Session = Depends(get_db),
                         user=Depends(require_role("admin"))):
    # Validate pair exists
    station = db.query(Station).filter(Station.id == data.station_id).first()
    if not station:
        raise HTTPException(404, f"Station with id {data.station_id} not found")

    payload = data.dict()
    payload["is_enabled"] = 1 if payload.get("is_enabled") is None or int(payload.get("is_enabled") or 0) else 0
    m = Machine(**payload)
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

    payload = data.dict(exclude_unset=True)
    if "station_id" in payload:
        station = db.query(Station).filter(Station.id == payload["station_id"]).first()
        if not station:
            raise HTTPException(404, f"Station with id {payload['station_id']} not found")

    if "is_enabled" in payload and payload["is_enabled"] is not None:
        payload["is_enabled"] = 1 if int(payload["is_enabled"]) else 0

    for k, v in payload.items():
        setattr(m, k, v)
    db.commit()
    db.refresh(m)
    await manager.broadcast({"type": "machine_updated", "id": m.id})
    return m


@router.post("/{machine_id}/enabled")
async def set_machine_enabled(
    machine_id: int,
    data: MachineEnabledBody,
    db: Session = Depends(get_db),
    user=Depends(require_role("admin")),
):
    m = db.query(Machine).filter(Machine.id == machine_id).first()
    if not m:
        raise HTTPException(404, "Machine not found")
    m.is_enabled = 1 if data.is_enabled else 0
    db.commit()
    db.refresh(m)
    await manager.broadcast({"type": "machine_updated", "id": m.id, "is_enabled": _machine_enabled(m)})
    return {"id": m.id, "is_enabled": _machine_enabled(m)}


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


@router.post("/cnc-live")
async def push_cnc_live_body(data: CncLivePush, db: Session = Depends(get_db)):
    """
    Node-RED → CNC live tags (preferred URL — same pattern as POST /telemetry).
    Body: { machine_id: 1, tags: [...], device_id: 10, device_name: "CN01" }
    Does NOT touch Servo Press /api/machines/telemetry.
    """
    from ..cnc_live_service import ensure_cnc_live_schema, upsert_cnc_live
    ensure_cnc_live_schema()
    mid = data.machine_id
    if mid is None:
        raise HTTPException(400, "machine_id is required")
    tags = data.tags if isinstance(data.tags, list) else []
    try:
        result = upsert_cnc_live(
            db,
            machine_id=int(mid),
            tags=tags,
            device_id=data.device_id if data.device_id is not None else data.deviceId,
            device_name=data.device_name or data.deviceName,
            source=data.source or "nodered",
        )
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    await manager.broadcast({
        "type": "machine_cnc_live_updated",
        "id": int(mid),
        "cnc_live": result,
    })
    return result


@router.post("/{machine_id}/cnc-live")
async def push_cnc_live(machine_id: int, data: CncLivePush, db: Session = Depends(get_db)):
    """
    Node-RED → CNC live tags for CN01 etc. (no JWT; same pattern as status push).
    Does NOT touch Servo Press /api/machines/telemetry.
    """
    from ..cnc_live_service import ensure_cnc_live_schema, upsert_cnc_live
    ensure_cnc_live_schema()
    tags = data.tags if isinstance(data.tags, list) else []
    try:
        result = upsert_cnc_live(
            db,
            machine_id=machine_id,
            tags=tags,
            device_id=data.device_id if data.device_id is not None else data.deviceId,
            device_name=data.device_name or data.deviceName,
            source=data.source or "nodered",
        )
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    await manager.broadcast({
        "type": "machine_cnc_live_updated",
        "id": machine_id,
        "cnc_live": result,
    })
    return result


@router.get("/{machine_id}/cnc-live")
def get_cnc_live_endpoint(machine_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    from ..cnc_live_service import ensure_cnc_live_schema, get_cnc_live
    ensure_cnc_live_schema()
    return get_cnc_live(db, machine_id)


@router.post("/telemetry")
async def push_telemetry_node_red(data: NodeRedTelemetryPush, db: Session = Depends(get_db)):
    """
    Node-RED → PMS telemetry ingest (no JWT; same pattern as status push).
    Body example:
      { syncBy:"MODBUS", deviceName:"Servo press", device:"<uuid>",
        readings:[{name:"status:Int16", value:"0"}, {name:"Live position", value:"42600"}, ...] }
    """
    from ..machine_telemetry_service import ensure_machine_telemetry_schema, upsert_telemetry_from_node_red
    ensure_machine_telemetry_schema()
    payload = data.model_dump()
    # Normalize readings to plain dicts
    payload["readings"] = [
        r if isinstance(r, dict) else (r.model_dump() if hasattr(r, "model_dump") else dict(r))
        for r in (payload.get("readings") or [])
    ]
    try:
        result = upsert_telemetry_from_node_red(db, payload, machine_id=data.machine_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    mid = result.get("machine_id") or data.machine_id
    if mid is not None and _should_broadcast_telemetry(int(mid), result):
        await manager.broadcast(_telemetry_ws_payload(int(mid), result))
    return result


@router.post("/{machine_id}/telemetry")
async def push_telemetry_for_machine(
    machine_id: int,
    data: NodeRedTelemetryPush,
    db: Session = Depends(get_db),
):
    """Same as /telemetry but forces target machine_id."""
    from ..machine_telemetry_service import ensure_machine_telemetry_schema, upsert_telemetry_from_node_red
    ensure_machine_telemetry_schema()
    payload = data.model_dump()
    payload["readings"] = [
        r if isinstance(r, dict) else (r.model_dump() if hasattr(r, "model_dump") else dict(r))
        for r in (payload.get("readings") or [])
    ]
    try:
        result = upsert_telemetry_from_node_red(db, payload, machine_id=machine_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    if _should_broadcast_telemetry(machine_id, result):
        await manager.broadcast(_telemetry_ws_payload(machine_id, result))
    return result

@router.get("/{machine_id}/telemetry")
def get_machine_telemetry(machine_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    from ..machine_telemetry_service import ensure_machine_telemetry_schema, get_telemetry_for_machine
    ensure_machine_telemetry_schema()
    m = db.query(Machine).filter(Machine.id == machine_id).first()
    if not m:
        raise HTTPException(404, "Machine not found")
    return get_telemetry_for_machine(db, machine_id)


class PlcThresholdBody(BaseModel):
    """LSL / USL per process tag for SPM_AH_PLC (and other generic_plc machines)."""
    thresholds: dict


@router.get("/{machine_id}/telemetry/thresholds")
def get_machine_plc_thresholds(machine_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    from ..machine_telemetry_service import ensure_machine_telemetry_schema, get_plc_thresholds
    ensure_machine_telemetry_schema()
    m = db.query(Machine).filter(Machine.id == machine_id).first()
    if not m:
        raise HTTPException(404, "Machine not found")
    return get_plc_thresholds(db, machine_id)


@router.put("/{machine_id}/telemetry/thresholds")
async def put_machine_plc_thresholds(
    machine_id: int,
    data: PlcThresholdBody,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    from ..machine_telemetry_service import ensure_machine_telemetry_schema, set_plc_thresholds
    ensure_machine_telemetry_schema()
    try:
        result = set_plc_thresholds(db, machine_id, data.thresholds or {})
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    await manager.broadcast({
        "type": "machine_telemetry_updated",
        "id": machine_id,
        "telemetry": {
            "thresholds": result.get("thresholds"),
            "threshold_breaches": result.get("threshold_breaches"),
            "alarms": result.get("alarms"),
            "email_alert_status": result.get("email_alert_status"),
        },
    })
    return result


@router.get("/telemetry/profiles")
def list_telemetry_profiles(db: Session = Depends(get_db), _=Depends(get_current_user)):
    """List machine telemetry UI profiles (Servo Press, generic PLC, …)."""
    from ..machine_telemetry_profiles import list_profiles
    return {"profiles": list_profiles(db=db)}


@router.get("/telemetry/profiles/{machine_type}")
def telemetry_profile_for_type(
    machine_type: str,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """Resolve Live/Result parameter screens for a machine_type."""
    from ..machine_telemetry_profiles import resolve_profile_for_machine_type
    return resolve_profile_for_machine_type(machine_type, db=db)


@router.get("/telemetry/modbus-catalog")
def servo_press_modbus_catalog(db: Session = Depends(get_db), _=Depends(get_current_user)):
    """Documented Modbus register map for Servo Press (§8.4.2)."""
    from ..machine_telemetry_profiles import resolve_profile_for_machine_type
    profile = resolve_profile_for_machine_type("Servo Press", db=db)
    return {
        "function_codes": ["03", "06", "16"],
        "rules": {
            "status_data": "Acquire anytime",
            "pressing_result": "Acquire when Status* is 4-8; cleared when Status* becomes 3",
        },
        "profile": profile,
        "registers": profile.get("registers") or {},
    }


class TelemetryTagCreate(BaseModel):
    item: str
    nodered_name: Optional[str] = None
    nodered_aliases: Optional[List[str]] = None
    tag_key: Optional[str] = None
    modbus: Optional[str] = None
    eip_pn: Optional[str] = None
    type: Optional[str] = "W"
    scale: Optional[float] = 1.0
    unit: Optional[str] = ""
    group: Optional[str] = "live"  # live | result | other
    note: Optional[str] = ""
    sort_order: Optional[int] = None
    is_enabled: Optional[bool] = True
    profile_id: Optional[str] = "servo_press"


class TelemetryTagUpdate(BaseModel):
    item: Optional[str] = None
    nodered_name: Optional[str] = None
    nodered_aliases: Optional[List[str]] = None
    tag_key: Optional[str] = None
    modbus: Optional[str] = None
    eip_pn: Optional[str] = None
    type: Optional[str] = None
    scale: Optional[float] = None
    unit: Optional[str] = None
    group: Optional[str] = None
    note: Optional[str] = None
    sort_order: Optional[int] = None
    is_enabled: Optional[bool] = None


@router.get("/telemetry/tags")
def list_telemetry_tags(
    profile_id: str = Query("servo_press"),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """List editable Node-RED ↔ UI tag mappings (Modbus catalog rows)."""
    from ..telemetry_tags_service import list_tags
    tags = list_tags(db, profile_id=profile_id)
    return {"profile_id": profile_id, "tags": tags, "count": len(tags)}


@router.post("/telemetry/tags")
def create_telemetry_tag(
    data: TelemetryTagCreate,
    db: Session = Depends(get_db),
    _=Depends(require_role("admin", "superadmin")),
):
    """Add a tag (e.g. Emergency button press) mapped to Live or Pressing Result screen."""
    from ..telemetry_tags_service import create_tag
    payload = data.model_dump()
    profile_id = payload.pop("profile_id", None) or "servo_press"
    try:
        return create_tag(db, payload, profile_id=profile_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.put("/telemetry/tags/{tag_id}")
def update_telemetry_tag(
    tag_id: int,
    data: TelemetryTagUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_role("admin", "superadmin")),
):
    """Edit Item / Node-RED name / Modbus / group / scale / unit for a tag."""
    from ..telemetry_tags_service import update_tag
    try:
        return update_tag(db, tag_id, data.model_dump(exclude_unset=True))
    except ValueError as exc:
        raise HTTPException(404 if "not found" in str(exc).lower() else 400, str(exc)) from exc


@router.delete("/telemetry/tags/{tag_id}")
def delete_telemetry_tag(
    tag_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_role("admin", "superadmin")),
):
    """Remove a tag from Live / Pressing Result mapping."""
    from ..telemetry_tags_service import delete_tag
    try:
        delete_tag(db, tag_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    return {"ok": True, "id": tag_id}


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
        # Open tablet timed loss — don't override with PLC idle/running (ignore when integration off / stale)
        try:
            from ..mobile_integration import is_mobile_integration_enabled
            from ..models import OperatorLossLog
            from datetime import timedelta as _td
            if is_mobile_integration_enabled(db):
                open_loss = db.query(OperatorLossLog).filter(
                    OperatorLossLog.machine_id == machine_id,
                    OperatorLossLog.status == "open",
                ).first()
                if open_loss:
                    started = open_loss.started_at
                    if started and (now_ist() - started) > _td(hours=12):
                        open_loss.status = "closed"
                        open_loss.ended_at = now_ist()
                        if open_loss.minutes is None or float(open_loss.minutes or 0) <= 0:
                            open_loss.minutes = round((now_ist() - started).total_seconds() / 60.0, 2)
                        open_loss.notes = ((open_loss.notes or "") + " [auto-closed: stale open session]").strip()
                        db.commit()
                    else:
                        return {
                            "id": machine_id,
                            "status": m.status,
                            "source": data.source,
                            "note": "operator loss active",
                        }
        except Exception:
            pass
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
    include_plan_metrics: bool = False,
    db: Session = Depends(get_db),
    _=Depends(get_current_user)
):
    from .hourly_output import _load_config

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

    # Auto-fill empty Deviation Reason from tablet loss logs (only when mobile integration ON)
    try:
        from ..mobile_integration import is_mobile_integration_enabled
        if is_mobile_integration_enabled(db):
            from ..models import OperatorLossLog
            loss_rows = (
                db.query(OperatorLossLog)
                .filter(OperatorLossLog.machine_id == machine_id)
                .order_by(OperatorLossLog.started_at.desc())
                .limit(100)
                .all()
            )
            updated = False
            for loss in loss_rows:
                if not loss.started_at:
                    continue
                reason_parts = [f"{loss.loss_code} · {loss.loss_description}"]
                if loss.sub_division:
                    reason_parts.append(loss.sub_division)
                reason = " · ".join(reason_parts)[:500]
                end_at = loss.ended_at or now_ist()
                from datetime import timedelta as _td
                win_start = loss.started_at - _td(seconds=2)
                win_end = end_at + _td(seconds=2)
                for log in logs:
                    if log.changed_at < win_start or log.changed_at > win_end:
                        continue
                    if log.status == "running" or log.source == "operator_loss_end":
                        continue
                    if not (log.deviation_reason or "").strip():
                        log.deviation_reason = reason
                        updated = True
            if updated:
                db.commit()
    except Exception as exc:
        print(f"[LossReasonSync] skipped: {exc}")

    result = []
    cfg = _load_config(db) if include_plan_metrics else {}
    hourly_cfg = cfg.get("hourly_output") if include_plan_metrics else {}
    ld_unld_max_sec = int((hourly_cfg or {}).get("ld_unld_max_sec", 60))

    for i, l in enumerate(logs):
        end_dt = logs[i - 1].changed_at if i > 0 else None
        duration_sec = max(0.0, (end_dt - l.changed_at).total_seconds()) if end_dt else 0.0
        row = {
            "id": l.id, "status": l.status,
            "changed_at": l.changed_at.strftime('%Y-%m-%dT%H:%M:%S'),
            "end_time": end_dt.strftime('%Y-%m-%dT%H:%M:%S') if end_dt else None,
            "source": l.source,
            "deviation_reason": l.deviation_reason or "",
        }
        if include_plan_metrics:
            plan = _pick_plan_for_segment(db, machine_id, l.changed_at, cfg)
            process_time_sec = float(plan.process_time or 0) if plan else 0.0
            loading_unloading_sec = float(plan.loading_unloading or 0) if plan else 0.0
            is_ld_unld = l.status == "idle" and 0 < duration_sec < ld_unld_max_sec
            row["process_time_sec"] = process_time_sec
            row["loading_unloading_sec"] = loading_unloading_sec
            row["running_completion_pct"] = (
                round(min(100.0, (duration_sec / process_time_sec) * 100), 2)
                if l.status == "running" and process_time_sec > 0 and duration_sec > 0
                else None
            )
            row["ld_unld_completion_pct"] = (
                round(min(100.0, (duration_sec / loading_unloading_sec) * 100), 2)
                if is_ld_unld and loading_unloading_sec > 0
                else None
            )
        result.append(row)

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
