"""
CNC live tags (Delta NC510 / Edge LO API) — independent of Servo Press Modbus telemetry.

Node-RED polls Edge ``/api/v1/devices/{id}/tags`` and POSTs here.
Machine status stays on ``PATCH /api/machines/{id}/status`` from StatusCode.
"""
from __future__ import annotations

import json
from typing import Any, Optional

from sqlalchemy.orm import Session

from .models import Machine, MachineCncLive, now_ist

_SCHEMA_READY = False

# Delta StatusCode → PMS status (same map as the Node-RED CNC status flow)
STATUS_CODE_MAP = {
    1: "running",
    2: "idle",
    3: "alarm",
    4: "offline",
}


def ensure_cnc_live_schema(bind=None) -> bool:
    global _SCHEMA_READY
    if _SCHEMA_READY and bind is None:
        return True
    from .models import engine

    if bind is None:
        bind = engine
    MachineCncLive.__table__.create(bind=bind, checkfirst=True)
    if bind is engine:
        _SCHEMA_READY = True
    return True


def _loads(raw, default):
    if not raw:
        return default
    try:
        return json.loads(raw) or default
    except Exception:
        return default


def _tag_value(raw: Any) -> Any:
    if raw is None:
        return None
    if isinstance(raw, dict):
        return raw.get("value", raw)
    return raw


def _sanitize_numeric(value: Any) -> Any:
    """Drop Edge garbage floats (e.g. 8.2E+299, -3E+170) so the UI stays readable."""
    if value is None or value == "":
        return None
    try:
        n = float(value)
    except (TypeError, ValueError):
        return value
    if n != n or abs(n) == float("inf"):  # NaN / Inf
        return None
    # Real CNC axis/feed values never need exponents this large
    if abs(n) > 1e12:
        return None
    return value


def normalize_lo_tags(tags: list) -> list[dict]:
    """Normalize Edge LO tag rows into a stable list for UI / storage."""
    out: list[dict] = []
    for row in tags or []:
        if not isinstance(row, dict):
            continue
        name = row.get("name") or row.get("register")
        if not name:
            continue
        value = _tag_value(row.get("value"))
        if value == "":
            value = None
        else:
            value = _sanitize_numeric(value)
        group = str(row.get("gp") or row.get("group") or "other").strip() or "other"
        out.append({
            "name": str(name),
            "value": value,
            "unit": row.get("unit") or "",
            "group": group,
            "type": row.get("type") or "",
            "dataType": row.get("dataType") or row.get("data_type") or "",
            "status": row.get("status"),
            "updateTime": row.get("updateTime") or row.get("update_time"),
        })
    return out


def _find_tag(tags: list[dict], name: str) -> Optional[dict]:
    target = name.lower()
    return next((t for t in (tags or []) if str(t.get("name") or "").lower() == target), None)


def derive_status_from_tags(tags: list[dict]) -> Optional[str]:
    """
    Map Edge tags → PMS status.

    Primary: StatusCode 1=running 2=idle 3=alarm 4=offline (Delta NC map).
    Fallback: CncStatus string when StatusCode missing.
    Activity override: if StatusCode says idle but spindle/feed is clearly active → running.
    """
    status_row = _find_tag(tags, "statuscode")
    code_status = None
    if status_row:
        raw = status_row.get("value")
        tag_status = status_row.get("status")
        if (tag_status == 0 or tag_status == "0") and (raw is None or raw == ""):
            code_status = "offline"
        elif raw is None or raw == "":
            code_status = "offline"
        else:
            try:
                code_status = STATUS_CODE_MAP.get(int(float(raw)), "offline")
            except (TypeError, ValueError):
                code_status = "offline"

    cnc_row = _find_tag(tags, "cncstatus")
    cnc_text = str((cnc_row or {}).get("value") or "").strip().upper()
    cnc_status = None
    if cnc_text:
        if any(k in cnc_text for k in ("ALARM", "ERROR", "FAULT")):
            cnc_status = "alarm"
        elif any(k in cnc_text for k in ("RUN", "BUSY", "CUT", "CYCLE", "FEED")):
            cnc_status = "running"
        elif any(k in cnc_text for k in ("OFF", "STOP")):
            cnc_status = "offline" if "OFF" in cnc_text else "idle"
        elif any(k in cnc_text for k in ("READY", "IDLE", "HOLD")):
            cnc_status = "idle"

    # Activity hint from live axis tags (ignore sanitized-away garbage)
    def _num(name: str) -> Optional[float]:
        row = _find_tag(tags, name)
        if not row or row.get("value") is None or row.get("value") == "":
            return None
        try:
            return float(row["value"])
        except (TypeError, ValueError):
            return None

    act_spindle = _num("actspindle")
    act_feed = _num("actfeed")
    active = (act_spindle is not None and abs(act_spindle) > 1.0) or (
        act_feed is not None and 0 < abs(act_feed) < 1e6
    )

    if code_status == "alarm" or cnc_status == "alarm":
        return "alarm"
    if code_status == "offline":
        return "offline"
    if code_status == "running" or cnc_status == "running" or active:
        return "running"
    if code_status is not None:
        return code_status
    if cnc_status is not None:
        return cnc_status
    return None


def _groups(tags: list[dict]) -> list[dict]:
    order: list[str] = []
    buckets: dict[str, list] = {}
    for t in tags:
        g = str(t.get("group") or "other")
        if g not in buckets:
            order.append(g)
            buckets[g] = []
        buckets[g].append(t)
    return [{"id": g, "label": g.replace("_", " ").title(), "tags": buckets[g]} for g in order]


def public_cnc_live(row: Optional[MachineCncLive], *, machine: Optional[Machine] = None) -> dict:
    if not row:
        return {"available": False, "machine_id": machine.id if machine else None, "tags": [], "groups": []}
    tags = _loads(row.tags_json, [])
    if not isinstance(tags, list):
        tags = []
    return {
        "available": True,
        "machine_id": row.machine_id,
        "device_id": row.device_id,
        "device_name": row.device_name or (machine.name if machine else None),
        "source": row.source or "nodered",
        "updated_at": row.updated_at.isoformat(timespec="seconds") if row.updated_at else None,
        "tags": tags,
        "groups": _groups(tags),
        "derived_status": derive_status_from_tags(tags),
        "tag_count": len(tags),
    }


def get_cnc_live(db: Session, machine_id: int) -> dict:
    ensure_cnc_live_schema()
    m = db.query(Machine).filter(Machine.id == int(machine_id)).first()
    if not m:
        return {"available": False, "error": "Machine not found", "tags": [], "groups": []}
    row = db.query(MachineCncLive).filter(MachineCncLive.machine_id == int(machine_id)).first()
    return public_cnc_live(row, machine=m)


def upsert_cnc_live(
    db: Session,
    *,
    machine_id: int,
    tags: list,
    device_id: Optional[int] = None,
    device_name: Optional[str] = None,
    source: str = "nodered",
) -> dict:
    ensure_cnc_live_schema()
    m = db.query(Machine).filter(Machine.id == int(machine_id)).first()
    if not m:
        raise ValueError(f"Machine {machine_id} not found")

    normalized = normalize_lo_tags(tags)
    row = (
        db.query(MachineCncLive)
        .filter(MachineCncLive.machine_id == int(machine_id))
        .with_for_update()
        .first()
    )
    if not row:
        row = MachineCncLive(machine_id=int(machine_id))
        db.add(row)

    row.device_id = int(device_id) if device_id is not None else row.device_id
    row.device_name = str(device_name) if device_name else (m.name or row.device_name)
    row.source = source or "nodered"
    row.tags_json = json.dumps(normalized)
    row.updated_at = now_ist()
    db.commit()
    db.refresh(row)
    return public_cnc_live(row, machine=m)
