"""
Persist / serve machine telemetry snapshots (Node-RED Modbus → Servo Press UI).
"""
from __future__ import annotations

import json
from typing import Any, Optional

from sqlalchemy.orm import Session

from .models import Machine, MachineTelemetry, now_ist
from .servo_press_modbus import (
    append_alarm_events,
    append_history_snapshot,
    append_plc_threshold_alarms,
    append_trend_point,
    apply_sticky_production,
    compute_modbus_kpi,
    ensure_shift_production_baseline,
    evaluate_plc_threshold_breaches,
    map_node_red_readings,
    merge_readings_by_name,
    normalize_plc_thresholds,
    PLC_THRESHOLD_TAGS,
    shift_production_from_runtime,
    update_runtime_stats,
)
from .telemetry_tags_service import (
    get_registers_and_aliases,
    profile_id_for_machine_type,
)

_TELEMETRY_SCHEMA_READY = False


def ensure_machine_telemetry_schema(bind=None):
    """Idempotent schema ensure — cached so Node-RED floods do not re-inspect every POST."""
    global _TELEMETRY_SCHEMA_READY
    if _TELEMETRY_SCHEMA_READY and bind is None:
        return True
    from sqlalchemy import text, inspect
    from .models import engine, _add_column_if_missing
    from .telemetry_tags_service import ensure_telemetry_tags_schema
    using_default = bind is None
    if bind is None:
        bind = engine
    MachineTelemetry.__table__.create(bind=bind, checkfirst=True)
    ensure_telemetry_tags_schema(bind)
    for col, ddl in (
        ("alarms_json", "alarms_json MEDIUMTEXT NULL"),
        ("history_json", "history_json MEDIUMTEXT NULL"),
        ("runtime_json", "runtime_json MEDIUMTEXT NULL"),
    ):
        try:
            _add_column_if_missing(bind, text, "machine_telemetry", col, ddl)
        except Exception:
            pass
    # One-time widen TEXT → MEDIUMTEXT (skip if already medium/long or if locked)
    try:
        insp = inspect(bind)
        cols = {c["name"]: c for c in insp.get_columns("machine_telemetry")}
        need = []
        for col in ("alarms_json", "history_json", "runtime_json", "mapped_json", "trend_json", "readings_json"):
            meta = cols.get(col) or {}
            typ = str(meta.get("type") or "").upper()
            if col in cols and "MEDIUM" not in typ and "LONG" not in typ:
                need.append(col)
        if need:
            with bind.connect() as conn:
                conn = conn.execution_options(isolation_level="AUTOCOMMIT")
                for col in need:
                    try:
                        conn.execute(text(f"ALTER TABLE machine_telemetry MODIFY COLUMN {col} MEDIUMTEXT NULL"))
                    except Exception:
                        pass
    except Exception:
        pass
    if using_default:
        _TELEMETRY_SCHEMA_READY = True
    return True


def _dispatch_setpoint_email_async(machine_id: int, profile_id: str, raised_events: list):
    """SMTP in a daemon thread with its own DB session — never block telemetry ingest."""
    import threading

    def _run():
        from .models import SessionLocal, Machine
        db = SessionLocal()
        try:
            m = db.query(Machine).filter(Machine.id == machine_id).first()
            if not m:
                return
            from .process_alert_modules import dispatch_raised_events
            status = dispatch_raised_events(
                db, machine=m, profile_id=profile_id, raised_events=raised_events,
            )
            if status:
                row = db.query(MachineTelemetry).filter(MachineTelemetry.machine_id == machine_id).first()
                if row:
                    runtime = _loads(row.runtime_json, {})
                    if not isinstance(runtime, dict):
                        runtime = {}
                    runtime["plc_email_status"] = status
                    row.runtime_json = json.dumps(runtime)
                    mapped = _loads(row.mapped_json, {})
                    if isinstance(mapped, dict):
                        mapped["email_alert_status"] = status
                        row.mapped_json = json.dumps(mapped)
                    db.commit()
        except Exception as exc:
            db.rollback()
            print(f"[WARN] async process setpoint email failed machine={machine_id}: {exc}")
        finally:
            db.close()

    threading.Thread(target=_run, name=f"setpoint-email-{machine_id}", daemon=True).start()


def _loads(raw, default):
    if not raw:
        return default
    try:
        return json.loads(raw) or default
    except Exception:
        return default


def _resolve_machine(db: Session, *, machine_id: Optional[int], device_name: Optional[str], device_uuid: Optional[str]) -> Optional[Machine]:
    if machine_id:
        m = db.query(Machine).filter(Machine.id == int(machine_id)).first()
        if m:
            return m
    if device_uuid:
        # Prefer machine whose plc_topic stores the Edge device UUID
        m = (
            db.query(Machine)
            .filter(Machine.plc_topic == device_uuid)
            .first()
        )
        if m:
            return m
        row = (
            db.query(MachineTelemetry)
            .filter(MachineTelemetry.device_uuid == device_uuid)
            .first()
        )
        if row:
            return db.query(Machine).filter(Machine.id == row.machine_id).first()
    if device_name:
        name = str(device_name).strip()
        m = db.query(Machine).filter(Machine.name == name).first()
        if m:
            return m
        # Case-insensitive / partial for "Servo press"
        for cand in db.query(Machine).all():
            if (cand.name or "").strip().lower() == name.lower():
                return cand
            if name.lower() in (cand.name or "").lower() or (cand.name or "").lower() in name.lower():
                if (cand.machine_type or "").lower().find("servo") >= 0 or "press" in (cand.name or "").lower():
                    return cand
        # Last resort: any Servo Press typed machine when deviceName mentions press
        if "press" in name.lower():
            return (
                db.query(Machine)
                .filter(Machine.machine_type.ilike("%Servo Press%"))
                .first()
            )
    return None


def _map_readings_for_machine(db: Session, readings: list, machine: Optional[Machine] = None) -> dict:
    profile_id = profile_id_for_machine_type(machine.machine_type if machine else None)
    try:
        registers, aliases = get_registers_and_aliases(db, profile_id=profile_id)
        return map_node_red_readings(readings, registers=registers, aliases=aliases)
    except Exception:
        return map_node_red_readings(readings)


def derive_pms_status_from_modbus(mapped: dict) -> Optional[str]:
    """
    Map Modbus Status* / Alarm Code → PMS machine.status.
      Alarm Code ≠ 0     → alarm
      Status* = 3        → running (Pressing)
      Status* = 4..8     → running (Result ready — cycle active/finished)
      Status* = 0        → idle
      other non-zero     → running
    """
    if not isinstance(mapped, dict):
        return None
    scaled = mapped.get("scaled") or {}
    alarm = scaled.get("alarm_code")
    try:
        if alarm is not None and float(alarm) != 0:
            return "alarm"
    except (TypeError, ValueError):
        pass

    status_info = mapped.get("status") or {}
    phase = status_info.get("phase")
    if phase == "pressing":
        return "running"
    if phase == "result":
        return "running"
    if phase == "idle":
        return "idle"
    if phase == "other":
        code = status_info.get("code")
        try:
            if code is not None and int(code) != 0:
                return "running"
        except (TypeError, ValueError):
            pass
        return "idle"
    # No Status* mapped yet — do not change PMS status
    return None


def sync_machine_status_from_telemetry(db: Session, machine: Machine, mapped: dict) -> Optional[str]:
    """Persist machines.status from latest Modbus snapshot; log transitions."""
    target = derive_pms_status_from_modbus(mapped)
    if not target:
        return None
    current = (machine.status or "").strip().lower() or "idle"
    if current == target:
        return target
    machine.status = target
    try:
        db.commit()
    except Exception:
        db.rollback()
        return None
    try:
        from .routers.machines import _log_status
        _log_status(machine.id, target, "modbus", db)
        db.commit()
    except Exception as exc:
        print(f"[WARN] modbus status log failed machine={machine.id}: {exc}")
    return target


def upsert_telemetry_from_node_red(db: Session, payload: dict, *, machine_id: Optional[int] = None) -> dict:
    incoming = payload.get("readings") or []
    if not isinstance(incoming, list):
        incoming = []
    device_name = payload.get("deviceName") or payload.get("device_name")
    device_uuid = payload.get("device") or payload.get("device_uuid")
    m = _resolve_machine(
        db,
        machine_id=machine_id or payload.get("machine_id"),
        device_name=device_name,
        device_uuid=device_uuid,
    )
    if not m:
        raise ValueError(
            "No matching machine for telemetry. "
            "Pass machine_id, or set deviceName to the machine name, "
            "or store Edge device UUID in machines.plc_topic."
        )

    profile_id = profile_id_for_machine_type(m.machine_type)
    is_plc = profile_id == "generic_plc"
    pending_setpoint_email = None

    # Lock the row so concurrent SIE partial posts (analogs / DO / DI) cannot lose updates
    row = (
        db.query(MachineTelemetry)
        .filter(MachineTelemetry.machine_id == m.id)
        .with_for_update()
        .first()
    )
    prev_readings = _loads(row.readings_json if row else None, [])
    if not isinstance(prev_readings, list):
        prev_readings = []
    readings = merge_readings_by_name(prev_readings, incoming)

    mapped = _map_readings_for_machine(db, readings, m)

    prev_mapped = _loads(row.mapped_json if row else None, {})
    prev_scaled = (prev_mapped.get("scaled") or {}) if isinstance(prev_mapped, dict) else {}
    prev_alarm = prev_scaled.get("alarm_code")

    prev_trend = _loads(row.trend_json if row else None, [])
    prev_alarms = (_loads(row.alarms_json if row else None, []) or [])[-80:]
    prev_history = (_loads(row.history_json if row else None, []) or [])[-80:]
    prev_runtime = _loads(row.runtime_json if row else None, {})

    incoming_has_analogs = _incoming_has_process_analogs(incoming)

    if is_plc:
        # PLC kits are process + coil telemetry only — no press production / OEE path
        mapped.pop("production", None)
        mapped["production"] = {"total": None, "good": None, "reject": None}
        mapped.pop("modbus_kpi", None)
        mapped.pop("shift_production", None)
        runtime = dict(prev_runtime or {})
        thresholds = normalize_plc_thresholds(runtime.get("plc_thresholds"))
        runtime["plc_thresholds"] = thresholds
        mapped["thresholds"] = thresholds
        # Trend only when a process-value event arrives (avoids 3× spam from SIE coil posts)
        trend = append_trend_point(prev_trend, mapped) if incoming_has_analogs else list(prev_trend or [])
        alarms, breaches = append_plc_threshold_alarms(
            prev_alarms, mapped, thresholds=thresholds, machine_id=m.id,
        )
        mapped["threshold_breaches"] = breaches
        # Email on newly raised LSL/USL breach events
        prev_ids = {
            str(a.get("event_id"))
            for a in (prev_alarms or [])
            if isinstance(a, dict) and a.get("kind") == "plc_threshold" and a.get("event") == "raised"
        }
        raised_new = [
            a for a in (alarms or [])
            if isinstance(a, dict)
            and a.get("kind") == "plc_threshold"
            and a.get("event") == "raised"
            and str(a.get("event_id") or "") not in prev_ids
        ]
        # Defer SMTP to background — never hold the telemetry DB transaction on email
        pending_setpoint_email = raised_new if raised_new else None
        if isinstance(runtime.get("plc_email_status"), dict) and not pending_setpoint_email:
            mapped["email_alert_status"] = runtime.get("plc_email_status")
        history = append_history_snapshot(prev_history, mapped)
    else:
        mapped = apply_sticky_production(mapped, prev_mapped=prev_mapped, runtime=prev_runtime)
        entry_date = None
        shift_id = None
        try:
            from .routers.config import _load_config
            from .routers.machines import _resolve_shift_at_ts
            cfg = _load_config(db)
            shift_id, ed = _resolve_shift_at_ts(now_ist(), cfg)
            entry_date = str(ed)
        except Exception:
            pass
        runtime_seed = ensure_shift_production_baseline(
            prev_runtime, mapped, entry_date=entry_date, shift_id=shift_id,
        )
        trend = append_trend_point(prev_trend, mapped)
        alarms = append_alarm_events(prev_alarms, mapped, prev_alarm=prev_alarm)
        history = append_history_snapshot(prev_history, mapped)
        runtime = update_runtime_stats(runtime_seed, mapped)
        runtime = ensure_shift_production_baseline(runtime, mapped, entry_date=entry_date, shift_id=shift_id)
        mapped["shift_production"] = shift_production_from_runtime(mapped, runtime)
        mapped["modbus_kpi"] = compute_modbus_kpi(mapped, runtime)

    if len(history) > 80:
        history = history[-80:]
    if len(alarms) > 80:
        alarms = alarms[-80:]

    if not row:
        row = MachineTelemetry(machine_id=m.id)
        db.add(row)

    row.sync_by = str(payload.get("syncBy") or payload.get("sync_by") or "MODBUS")
    row.device_name = str(device_name) if device_name else m.name
    row.device_uuid = str(device_uuid) if device_uuid else None
    row.origin = str(payload.get("origin") or "")
    row.readings_json = json.dumps(readings)
    row.mapped_json = json.dumps(mapped)
    row.trend_json = json.dumps(trend)
    row.alarms_json = json.dumps(alarms)
    row.history_json = json.dumps(history)
    row.runtime_json = json.dumps(runtime)
    row.updated_at = now_ist()
    try:
        db.commit()
    except Exception:
        db.rollback()
        alarms = alarms[-40:]
        history = history[-40:]
        trend = trend[-40:] if isinstance(trend, list) else trend
        row.alarms_json = json.dumps(alarms)
        row.history_json = json.dumps(history)
        row.trend_json = json.dumps(trend)
        row.updated_at = now_ist()
        db.commit()

    if pending_setpoint_email:
        _dispatch_setpoint_email_async(m.id, profile_id, pending_setpoint_email)

    if not is_plc:
        try:
            sync_machine_status_from_telemetry(db, m, mapped)
            db.refresh(m)
        except Exception as exc:
            print(f"[WARN] telemetry status sync failed machine={m.id}: {exc}")

    return public_telemetry(row, machine=m, db=db)


_PLC_ANALOG_HINTS = ("pressure", "flow", "tank", "temperature", "plcstatus", "plc_status")


def _incoming_has_process_analogs(incoming: list) -> bool:
    for row in incoming or []:
        if not isinstance(row, dict):
            continue
        name = str(row.get("name") or "").lower()
        if any(h in name for h in _PLC_ANALOG_HINTS):
            return True
    return False


def _plc_param_rows(rows: list) -> list:
    """Drop legacy packed DI/DO words — coils drive the Machine Status panels."""
    skip = {"digital_input_status", "digital_output_status"}
    out = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        if row.get("key") in skip:
            continue
        out.append(row)
    return out


def _plc_scaled(scaled: dict) -> dict:
    if not isinstance(scaled, dict):
        return {}
    keep_prefixes = ("pressure", "flow", "tank", "temp", "plc", "di_", "do_")
    out = {}
    for key, val in scaled.items():
        k = str(key)
        if k in ("pressure", "flow", "tank_level", "temperature", "plc_status") or k.startswith(("di_", "do_")):
            out[k] = val
        elif any(k.startswith(p) for p in keep_prefixes):
            out[k] = val
    return out


def _plc_history_view(history: list) -> list:
    """History rows for PLC: process tags + coil bitmasks only."""
    view = []
    for h in history or []:
        if not isinstance(h, dict):
            continue
        view.append({
            "ts": h.get("ts"),
            "t": h.get("t"),
            "pressure": h.get("pressure"),
            "flow": h.get("flow"),
            "tank_level": h.get("tank_level"),
            "temperature": h.get("temperature"),
            "digital_input_status": h.get("digital_input_status"),
            "digital_output_status": h.get("digital_output_status"),
            "plc_status": h.get("plc_status"),
            "di_bits": h.get("di_bits"),
            "do_bits": h.get("do_bits"),
        })
    return view


def _profile_summary(machine: Optional[Machine], db: Optional[Session]) -> dict:
    """Configured tag catalog + screen labels for this machine's telemetry profile."""
    empty = {"registers": None, "profile": None}
    if db is None:
        return empty
    try:
        from .machine_telemetry_profiles import resolve_profile_for_machine_type

        resolved = resolve_profile_for_machine_type(
            machine.machine_type if machine else None, db=db,
        )
        return {
            "registers": resolved.get("registers") or {},
            "profile": {
                "id": resolved.get("id"),
                "label": resolved.get("label"),
                "screens": resolved.get("screens") or [],
                "machine_type": machine.machine_type if machine else None,
            },
        }
    except Exception:
        return empty


def public_telemetry(
    row: Optional[MachineTelemetry],
    machine: Optional[Machine] = None,
    db: Optional[Session] = None,
) -> dict:
    # The configured tag catalog is what the Parameters screens are built from, so it is
    # reported whether or not telemetry has arrived: a freshly typed machine then lists
    # its own tags with "—" values instead of borrowing the Servo Press defaults.
    profile = _profile_summary(machine, db)
    profile_id = (profile.get("profile") or {}).get("id") if profile.get("profile") else None
    if not profile_id and machine is not None:
        profile_id = profile_id_for_machine_type(machine.machine_type)
    is_plc = profile_id == "generic_plc"

    if not row:
        skeleton = map_node_red_readings([], registers=profile["registers"] or {}, aliases={})
        if is_plc:
            return {
                "machine_id": machine.id if machine else None,
                "available": False,
                "updated_at": None,
                "sync_by": None,
                "device_name": None,
                "device_uuid": None,
                "origin": None,
                "current_tiles": skeleton.get("current_tiles") or [],
                "digital_io": skeleton.get("digital_io") or {"inputs": [], "outputs": []},
                "param_rows": [],
                "scaled": {},
                "thresholds": normalize_plc_thresholds({}),
                "threshold_breaches": {},
                "trend": [],
                "alarms": [],
                "history": [],
                "registers": profile["registers"],
                "profile": profile["profile"],
            }
        return {
            "machine_id": machine.id if machine else None,
            "available": False,
            "updated_at": None,
            "sync_by": None,
            "device_name": None,
            "production": {},
            "current": {},
            "current_tiles": skeleton.get("current_tiles") or [],
            "io_status": skeleton.get("io_status") or [],
            "digital_io": skeleton.get("digital_io") or {"inputs": [], "outputs": []},
            "param_rows": [],
            "status": {},
            "trend": [],
            "alarms": [],
            "history": [],
            "modbus_kpi": None,
            "registers": profile["registers"],
            "profile": profile["profile"],
        }
    mapped: dict[str, Any] = _loads(row.mapped_json, {})
    runtime = _loads(row.runtime_json, {})
    # Remap from stored readings using current tag catalog so UI picks up new tags immediately
    if db is not None:
        try:
            readings = _loads(row.readings_json, [])
            if isinstance(readings, list):
                fresh = _map_readings_for_machine(db, readings, machine)
                if not is_plc:
                    fresh = apply_sticky_production(fresh, prev_mapped=mapped, runtime=runtime)
                    try:
                        from .routers.config import _load_config
                        from .routers.machines import _resolve_shift_at_ts
                        cfg = _load_config(db)
                        sid, ed = _resolve_shift_at_ts(now_ist(), cfg)
                        runtime = ensure_shift_production_baseline(
                            runtime, fresh, entry_date=str(ed), shift_id=sid,
                        )
                    except Exception:
                        pass
                    fresh["shift_production"] = shift_production_from_runtime(fresh, runtime)
                    fresh["modbus_kpi"] = compute_modbus_kpi(fresh, runtime)
                mapped = fresh
        except Exception:
            pass
    trend = _loads(row.trend_json, [])
    alarms = _loads(row.alarms_json, [])
    history = _loads(row.history_json, [])
    alarms_view = list(reversed(alarms)) if alarms else []
    history_view = list(reversed(history)) if history else []

    if is_plc:
        # PLC Machine Dashboard — raw process + coil data only (no Servo Press blocks)
        thresholds = normalize_plc_thresholds(
            (runtime.get("plc_thresholds") if isinstance(runtime, dict) else None)
            or mapped.get("thresholds")
        )
        breaches = mapped.get("threshold_breaches")
        if not isinstance(breaches, dict):
            breaches = evaluate_plc_threshold_breaches(mapped.get("scaled") or {}, thresholds)
        plc_trend = [
            {
                "t": p.get("t"),
                "ts": p.get("ts"),
                "pressure": p.get("pressure"),
                "flow": p.get("flow"),
                "tank_level": p.get("tank_level"),
                "temperature": p.get("temperature"),
            }
            for p in (trend or [])
            if isinstance(p, dict)
        ]
        return {
            "machine_id": row.machine_id,
            "available": True,
            "updated_at": row.updated_at.isoformat(timespec="seconds") if row.updated_at else None,
            "sync_by": row.sync_by,
            "device_name": row.device_name,
            "device_uuid": row.device_uuid,
            "origin": row.origin,
            "current_tiles": mapped.get("current_tiles") or [],
            "digital_io": mapped.get("digital_io") or {"inputs": [], "outputs": []},
            "param_rows": _plc_param_rows(mapped.get("param_rows") or []),
            "scaled": _plc_scaled(mapped.get("scaled") or {}),
            "thresholds": thresholds,
            "threshold_breaches": breaches,
            "email_alert_status": (
                mapped.get("email_alert_status")
                or (runtime.get("plc_email_status") if isinstance(runtime, dict) else None)
            ),
            "trend": plc_trend,
            "alarms": alarms_view,
            "history": _plc_history_view(history_view),
            "registers": mapped.get("registers") or profile["registers"],
            "profile": profile["profile"],
        }

    modbus_kpi = mapped.get("modbus_kpi")
    if not modbus_kpi:
        modbus_kpi = compute_modbus_kpi(mapped, runtime)
    shift_prod = mapped.get("shift_production") or shift_production_from_runtime(mapped, runtime)
    return {
        "machine_id": row.machine_id,
        "available": True,
        "updated_at": row.updated_at.isoformat(timespec="seconds") if row.updated_at else None,
        "sync_by": row.sync_by,
        "device_name": row.device_name,
        "device_uuid": row.device_uuid,
        "origin": row.origin,
        "production": mapped.get("production") or {},
        "shift_production": shift_prod,
        "current": mapped.get("current") or {},
        "current_tiles": mapped.get("current_tiles") or [],
        "io_status": mapped.get("io_status") or [],
        "digital_io": mapped.get("digital_io") or {"inputs": [], "outputs": []},
        "param_rows": mapped.get("param_rows") or [],
        "status": mapped.get("status") or {},
        "pressing_result": mapped.get("pressing_result") or {},
        "scaled": mapped.get("scaled") or {},
        "result_ready": mapped.get("result_ready"),
        "trend": trend,
        "alarms": alarms_view,
        "history": history_view,
        "modbus_kpi": modbus_kpi,
        "registers": mapped.get("registers") or profile["registers"],
        "profile": profile["profile"],
    }


def get_telemetry_for_machine(db: Session, machine_id: int) -> dict:
    row = db.query(MachineTelemetry).filter(MachineTelemetry.machine_id == machine_id).first()
    m = db.query(Machine).filter(Machine.id == machine_id).first()
    return public_telemetry(row, machine=m, db=db)


def get_plc_thresholds(db: Session, machine_id: int) -> dict:
    row = db.query(MachineTelemetry).filter(MachineTelemetry.machine_id == machine_id).first()
    runtime = _loads(row.runtime_json if row else None, {})
    thresholds = normalize_plc_thresholds(
        (runtime.get("plc_thresholds") if isinstance(runtime, dict) else None) or {}
    )
    tags = [
        {
            "key": key,
            "label": label,
            "unit": unit,
            **(thresholds.get(key) or {}),
        }
        for key, label, unit in PLC_THRESHOLD_TAGS
    ]
    return {"machine_id": machine_id, "thresholds": thresholds, "tags": tags}


def set_plc_thresholds(db: Session, machine_id: int, thresholds_in: dict) -> dict:
    m = db.query(Machine).filter(Machine.id == machine_id).first()
    if not m:
        raise ValueError("Machine not found")
    row = db.query(MachineTelemetry).filter(MachineTelemetry.machine_id == machine_id).first()
    if not row:
        row = MachineTelemetry(machine_id=machine_id)
        db.add(row)
        row.readings_json = "[]"
        row.mapped_json = "{}"
        row.trend_json = "[]"
        row.alarms_json = "[]"
        row.history_json = "[]"
        row.runtime_json = "{}"
    runtime = _loads(row.runtime_json, {})
    if not isinstance(runtime, dict):
        runtime = {}
    thresholds = normalize_plc_thresholds(thresholds_in)
    runtime["plc_thresholds"] = thresholds
    row.runtime_json = json.dumps(runtime)
    row.updated_at = now_ist()

    # Re-evaluate against latest scaled values so Alarms refresh immediately
    mapped = _loads(row.mapped_json, {})
    if not isinstance(mapped, dict):
        mapped = {}
    mapped["thresholds"] = thresholds
    prev_alarms = _loads(row.alarms_json, []) or []
    alarms, breaches = append_plc_threshold_alarms(
        prev_alarms, mapped, thresholds=thresholds, machine_id=machine_id,
    )
    mapped["threshold_breaches"] = breaches
    prev_ids = {
        str(a.get("event_id"))
        for a in (prev_alarms or [])
        if isinstance(a, dict) and a.get("kind") == "plc_threshold" and a.get("event") == "raised"
    }
    raised_new = [
        a for a in (alarms or [])
        if isinstance(a, dict)
        and a.get("kind") == "plc_threshold"
        and a.get("event") == "raised"
        and str(a.get("event_id") or "") not in prev_ids
    ]
    email_status = None
    if raised_new:
        # Mark pending in UI; actual SMTP runs async after commit
        email_status = {
            "status": "pending",
            "message": "Process setpoint email queued",
            "sent_at": now_ist().isoformat(timespec="seconds"),
            "recipients": [],
            "event_ids": [a.get("event_id") for a in raised_new],
        }
        runtime["plc_email_status"] = email_status
        mapped["email_alert_status"] = email_status
    row.alarms_json = json.dumps(alarms)
    row.mapped_json = json.dumps(mapped)
    row.runtime_json = json.dumps(runtime)
    db.commit()
    if raised_new:
        profile_id = profile_id_for_machine_type(m.machine_type)
        _dispatch_setpoint_email_async(machine_id, profile_id, raised_new)
    return {
        "machine_id": machine_id,
        "thresholds": thresholds,
        "threshold_breaches": breaches,
        "alarms": list(reversed(alarms[-40:])),
        "email_alert_status": email_status or runtime.get("plc_email_status"),
    }
