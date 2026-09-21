"""
Servo Press OEE — separate from PMS CNC / Data Entry / machine_kpi formulas.

Formula (Modbus §8.4.2 + production plan context):
  Available time  = shift length − breaks  (from site config / plan shift)
  Expected qty    = floor(available_sec / cycle_time) using plan CT
                    (capped by planned_qty when planned_qty > 0)

  AR = (Pressing + Result-ready seconds) / available_sec × 100
       from Modbus Status* phase timing (runtime_json)
  PR = shift_actual / expected_qty × 100
       shift_actual = Modbus Total − shift-start baseline
  QR = shift_good / shift_actual × 100
       from Modbus Pass/NG − shift baselines
  AR / PR / QR are each capped at 100% (same rule as Data Entry OEE), then
  OEE = AR × PR × QR / 10000
  so the headline OEE always equals the product of the rates shown on screen.

Does NOT modify ProductionPlan.actual_qty or _compute_kpi / Data Entry OEE.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any, Optional

from sqlalchemy.orm import Session

from .machine_telemetry_profiles import is_telemetry_dashboard_type
from .servo_press_modbus import (
    _to_number,
    ensure_shift_production_baseline,
    shift_production_from_runtime,
)


def uses_telemetry_dashboard(machine) -> bool:
    """Servo Press, Servo Linear Motor, PLC and SPM all run on this formula.

    They share the Modbus telemetry dashboard, so they share its OEE: actuals come
    from mapped Node-RED counters and phase timing rather than status-log part
    counting. CNC and the rest stay on the PMS machine_kpi formulas.
    """
    return is_telemetry_dashboard_type(getattr(machine, "machine_type", None))


def _shift_available_minutes(cfg: dict, entry_date: date, shift_id: str) -> tuple[float, float, Optional[dict]]:
    """Return (available_min, shift_total_min, shift_def)."""
    from .routers.hourly_output import _break_windows, _shift_window

    shifts = [s for s in (cfg.get("shifts") or []) if s.get("enabled", True)]
    shift_def = next((s for s in shifts if s.get("id") == shift_id), None)
    if not shift_def and shift_id:
        shift_def = next((s for s in shifts if (s.get("name") or "") == shift_id), None)
    if not shift_def:
        return 0.0, 0.0, None

    shift_start, shift_end = _shift_window(entry_date, shift_def)
    shift_total_min = (shift_end - shift_start).total_seconds() / 60.0
    break_cfg = (cfg.get("breaks") or {}).get(shift_id, {})
    breaks = _break_windows(break_cfg)
    break_min = sum(float(b.get("minutes") or 0) for b in breaks)
    available = max(0.0, shift_total_min - break_min)
    return available, shift_total_min, shift_def


def _plan_context(db: Session, machine_id: int, entry_date: date, shift_id: str) -> dict:
    from .models import ProductionPlan

    plans = (
        db.query(ProductionPlan)
        .filter(
            ProductionPlan.machine_id == machine_id,
            ProductionPlan.plan_date == entry_date,
            ProductionPlan.shift == shift_id,
            ProductionPlan.status.in_(
                ["running", "completed", "paused", "pending", "incomplete", "aborted"]
            ),
        )
        .all()
    )
    planned_qty = sum(int(p.planned_qty or 0) for p in plans)
    ct = 0.0
    process_sec = 0.0
    load_sec = 0.0
    for p in plans:
        process_sec = float(p.process_time or 0)
        load_sec = float(p.loading_unloading or 0)
        ct = process_sec + load_sec
        if ct > 0:
            break
    model_variant = " · ".join(
        sorted({(p.model_variant or "").strip() for p in plans if (p.model_variant or "").strip()})
    ) or None
    return {
        "plans": plans,
        "planned_qty": planned_qty,
        "cycle_time_sec": ct,
        "process_time_sec": process_sec,
        "loading_unloading_sec": load_sec,
        "model_variant": model_variant,
    }


def _load_telemetry_bundle(db: Session, machine_id: int) -> tuple[dict, dict]:
    """Return (mapped readings, runtime) without mutating plan KPIs."""
    from .machine_telemetry_service import _loads, _map_readings_for_machine
    from .models import Machine, MachineTelemetry
    from .servo_press_modbus import apply_sticky_production

    row = db.query(MachineTelemetry).filter(MachineTelemetry.machine_id == machine_id).first()
    machine = db.query(Machine).filter(Machine.id == machine_id).first()
    if not row:
        return {}, {}
    mapped = _loads(row.mapped_json, {})
    runtime = _loads(row.runtime_json, {})
    try:
        readings = _loads(row.readings_json, [])
        if isinstance(readings, list) and readings:
            fresh = _map_readings_for_machine(db, readings, machine)
            fresh = apply_sticky_production(fresh, prev_mapped=mapped, runtime=runtime)
            mapped = fresh
    except Exception:
        pass
    return mapped, runtime


def compute_servo_press_oee(
    db: Session,
    machine,
    entry_date: date,
    shift_id: str,
    cfg: dict,
) -> Optional[dict]:
    """
    Dedicated Modbus telemetry OEE panel. Shape mirrors machine_kpi for UI reuse,
    with formula='servo_press_modbus' and source='servo_press'.
    """
    if not uses_telemetry_dashboard(machine):
        return None

    available_min, shift_total_min, shift_def = _shift_available_minutes(cfg, entry_date, shift_id)
    if not shift_def:
        return None

    plan_ctx = _plan_context(db, machine.id, entry_date, shift_id)
    ct = float(plan_ctx["cycle_time_sec"] or 0)
    planned_qty = int(plan_ctx["planned_qty"] or 0)

    mapped, runtime = _load_telemetry_bundle(db, machine.id)
    runtime = ensure_shift_production_baseline(
        runtime, mapped, entry_date=str(entry_date), shift_id=shift_id,
    )
    shift_prod = shift_production_from_runtime(mapped, runtime)

    buckets = (runtime.get("seconds") or {}) if isinstance(runtime, dict) else {}
    pressing_sec = float(buckets.get("pressing") or 0)
    result_sec = float(buckets.get("result") or 0)
    idle_sec = float(buckets.get("idle") or 0)
    alarm_sec = float(buckets.get("alarm") or 0)
    other_sec = float(buckets.get("other") or 0)
    productive_sec = pressing_sec + result_sec
    tracked_sec = productive_sec + idle_sec + alarm_sec + other_sec

    available_sec = available_min * 60.0
    # Prefer calendar available time; if telemetry window is shorter early in shift,
    # AR still uses full available (same as PMS) so rates are comparable.
    ar_raw = round((productive_sec / available_sec) * 100, 2) if available_sec > 0 else 0.0

    expected_qty = int(available_sec / ct) if ct > 0 else 0
    if planned_qty > 0 and expected_qty > 0:
        expected_qty = min(expected_qty, planned_qty)
    elif planned_qty > 0 and expected_qty == 0:
        expected_qty = planned_qty

    actual = int(shift_prod.get("total") or 0)
    good = shift_prod.get("good")
    reject = shift_prod.get("reject")
    if good is None and reject is not None:
        good = max(0, actual - int(reject))
    if good is None:
        good = actual
    if reject is None:
        reject = max(0, actual - int(good))
    good = int(good)
    reject = int(reject)

    pr_raw = round((actual / expected_qty) * 100, 2) if expected_qty > 0 else 0.0
    qr_raw = round((good / actual) * 100, 2) if actual > 0 else 100.0
    # Cap each rate at 100% before multiplying — matches Data Entry / OEE Dashboard.
    # Without this, actual ≫ expected made PR (and OEE) soar past 100, and the UI
    # clamped each number separately so AR×PR×QR no longer equalled the OEE tile.
    ar = min(ar_raw, 100.0)
    pr = min(pr_raw, 100.0)
    qr = min(qr_raw, 100.0)
    oee = round(ar * pr * qr / 10000, 2)
    oee_raw = round(ar_raw * pr_raw * qr_raw / 10000, 2)

    operating_min = round(productive_sec / 60.0, 1)
    uptime_min = round(pressing_sec / 60.0, 1)
    downtime_min = round(max(0.0, available_min - operating_min), 1)
    theoretical_qty = int((shift_total_min * 60.0) / ct) if ct > 0 else 0
    mur = min(round((uptime_min / available_min) * 100, 2), 100.0) if available_min > 0 else 0.0
    prod_yield_raw = round((actual / theoretical_qty) * 100, 2) if theoretical_qty > 0 else 0.0
    prod_yield = min(prod_yield_raw, 100.0)
    teep = round(oee * mur / 100, 2)

    from .models import Station

    station = db.query(Station).filter(Station.id == machine.station_id).first()

    return {
        "formula": "servo_press_modbus",
        "source": "servo_press",
        "machine_id": machine.id,
        "machine_name": machine.name,
        "machine_status": machine.status or "idle",
        "machine_type": machine.machine_type,
        "make": machine.make,
        "model_no": machine.model_no,
        "image_url": machine.image_url,
        "station_name": station.display_name if station else str(machine.station_id),
        "location": machine.location or "",
        "entry_date": str(entry_date),
        "shift": shift_id,
        "shift_name": shift_def.get("name", shift_id),
        "shift_start": shift_def.get("start"),
        "shift_end": shift_def.get("end"),
        "model_variant": plan_ctx.get("model_variant"),
        "cycle_time_sec": ct,
        "process_time_sec": plan_ctx.get("process_time_sec") or 0,
        "loading_unloading_sec": plan_ctx.get("loading_unloading_sec") or 0,
        "available_time_min": round(available_min, 1),
        "operating_time_min": operating_min,
        "uptime_min": uptime_min,
        "machining_time_min": uptime_min,
        "actual_production_time_min": uptime_min,
        "downtime_min": downtime_min,
        "planned_qty": planned_qty,
        "actual_qty": actual,
        "good_qty": good,
        "defect_qty": reject,
        "expected_qty": expected_qty,
        "theoretical_qty": theoretical_qty,
        "shift_production": shift_prod,
        "runtime_seconds": {
            "pressing": round(pressing_sec, 1),
            "result": round(result_sec, 1),
            "idle": round(idle_sec, 1),
            "alarm": round(alarm_sec, 1),
            "other": round(other_sec, 1),
            "tracked": round(tracked_sec, 1),
        },
        "kpi": {
            "ar": ar,
            "pr": pr,
            "qr": qr,
            "oee": oee,
            "machine_utilization": mur,
            "production_yield": prod_yield,
            "teep": teep,
            "ar_raw": ar_raw,
            "pr_raw": pr_raw,
            "qr_raw": qr_raw,
            "oee_raw": oee_raw if oee_raw > oee else None,
            "production_yield_raw": prod_yield_raw if prod_yield_raw > prod_yield else None,
        },
        "note": (
            "Servo Press OEE: AR from Modbus Status* (Pressing+Result) / shift available; "
            "PR/QR from Modbus shift Total/Pass/NG vs plan expected qty. "
            "AR/PR/QR capped at 100% then OEE = AR×PR×QR/10000. "
            "Independent of CNC/Data Entry / Production Dashboard KPI formulas."
        ),
    }


def apply_servo_oee_to_realtime_row(row: dict, servo: dict) -> dict:
    """Overlay Servo Press OEE onto an OEE Dashboard realtime row."""
    if not row or not servo:
        return row
    out = dict(row)
    kpi = servo.get("kpi") or {}
    out["ar"] = kpi.get("ar", out.get("ar"))
    out["pr"] = kpi.get("pr", out.get("pr"))
    out["qr"] = kpi.get("qr", out.get("qr"))
    out["oee"] = kpi.get("oee", out.get("oee"))
    out["actual_qty"] = servo.get("actual_qty", out.get("actual_qty"))
    out["accp_qty"] = servo.get("good_qty", out.get("accp_qty"))
    out["defect_qty"] = servo.get("defect_qty", out.get("defect_qty"))
    out["possible_qty"] = servo.get("expected_qty", out.get("possible_qty"))
    out["operating_time"] = int(round(float(servo.get("operating_time_min") or 0)))
    out["available_shift_time"] = int(round(float(servo.get("available_time_min") or 0)))
    out["production_loss"] = max(
        0, int(out.get("possible_qty") or 0) - int(out.get("actual_qty") or 0)
    )
    out["source"] = "realtime_servo_press"
    out["oee_formula"] = "servo_press_modbus"
    return out
