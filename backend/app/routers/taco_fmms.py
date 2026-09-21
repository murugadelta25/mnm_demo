"""TACO-FMMS API — TATA AutoComp calibration vendor + testing equipment sharing."""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import inspect as sa_inspect, func
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..models import get_db, engine, Base
from ..models_fmms import FmmsAsset
from ..models_taco import (
    TacoVendor, TacoVendorEquipmentMap, TacoVendorRateCard, TacoVendorWorkflow,
    TacoCalibrationCost, TacoTestingEquipment, TacoTestingBooking, TacoReservationRule,
)

router = APIRouter(prefix="/api/fmms/taco", tags=["taco-fmms"])

BUSINESS_UNITS = [
    "Interior Systems",
    "Lighting Systems",
    "Seating Systems",
    "HVAC Systems",
    "Electronics",
    "Composites",
]


def _ensure_taco_tables():
    insp = sa_inspect(engine)
    tables = [
        TacoVendor.__table__,
        TacoVendorEquipmentMap.__table__,
        TacoVendorRateCard.__table__,
        TacoVendorWorkflow.__table__,
        TacoCalibrationCost.__table__,
        TacoTestingEquipment.__table__,
        TacoTestingBooking.__table__,
        TacoReservationRule.__table__,
    ]
    missing = [t.name for t in tables if not insp.has_table(t.name)]
    if missing:
        Base.metadata.create_all(bind=engine, tables=tables)
        print(f"[TACO-FMMS] Created tables: {missing}")
    _ensure_vendor_columns(sa_inspect(engine))


def _ensure_vendor_columns(insp):
    """Add approval-workflow columns on existing taco_vendors deployments."""
    from sqlalchemy import text
    if not insp.has_table("taco_vendors"):
        return
    existing = {c["name"] for c in insp.get_columns("taco_vendors")}
    alters = []
    if "pending_reason" not in existing:
        alters.append("ADD COLUMN pending_reason TEXT NULL")
    if "decision_reason" not in existing:
        alters.append("ADD COLUMN decision_reason TEXT NULL")
    if "reviewed_by" not in existing:
        alters.append("ADD COLUMN reviewed_by VARCHAR(100) NULL")
    if "reviewed_at" not in existing:
        alters.append("ADD COLUMN reviewed_at DATETIME NULL")
    if alters:
        with engine.begin() as conn:
            for stmt in alters:
                try:
                    conn.execute(text(f"ALTER TABLE taco_vendors {stmt}"))
                except Exception as exc:
                    print(f"[TACO-FMMS] vendor column migrate skipped: {exc}")
        print(f"[TACO-FMMS] taco_vendors columns migrated ({len(alters)} added)")

    # Testing equipment / booking columns
    if insp.has_table("taco_testing_equipment"):
        eq_cols = {c["name"] for c in insp.get_columns("taco_testing_equipment")}
        eq_alters = []
        if "duration_options_min" not in eq_cols:
            eq_alters.append("ADD COLUMN duration_options_min VARCHAR(100) DEFAULT '30,60,120'")
        if "default_duration_min" not in eq_cols:
            eq_alters.append("ADD COLUMN default_duration_min INT DEFAULT 60")
        if "day_start" not in eq_cols:
            eq_alters.append("ADD COLUMN day_start VARCHAR(10) DEFAULT '09:00'")
        if "day_end" not in eq_cols:
            eq_alters.append("ADD COLUMN day_end VARCHAR(10) DEFAULT '18:00'")
        if "cost_per_hour" not in eq_cols:
            eq_alters.append("ADD COLUMN cost_per_hour FLOAT DEFAULT 0")
        if eq_alters:
            with engine.begin() as conn:
                for stmt in eq_alters:
                    try:
                        conn.execute(text(f"ALTER TABLE taco_testing_equipment {stmt}"))
                    except Exception as exc:
                        print(f"[TACO-FMMS] equipment column migrate skipped: {exc}")
            print(f"[TACO-FMMS] taco_testing_equipment columns migrated ({len(eq_alters)} added)")

    if insp.has_table("taco_testing_bookings"):
        bk_cols = {c["name"] for c in insp.get_columns("taco_testing_bookings")}
        bk_alters = []
        if "duration_min" not in bk_cols:
            bk_alters.append("ADD COLUMN duration_min INT DEFAULT 60")
        if "asset_under_test" not in bk_cols:
            bk_alters.append("ADD COLUMN asset_under_test VARCHAR(120) NULL")
        if "asset_under_test_name" not in bk_cols:
            bk_alters.append("ADD COLUMN asset_under_test_name VARCHAR(200) NULL")
        if "fmms_wo_number" not in bk_cols:
            bk_alters.append("ADD COLUMN fmms_wo_number VARCHAR(50) NULL")
        if "cost_amount" not in bk_cols:
            bk_alters.append("ADD COLUMN cost_amount FLOAT DEFAULT 0")
        if "submitted_at" not in bk_cols:
            bk_alters.append("ADD COLUMN submitted_at DATETIME NULL")
        if "decision_reason" not in bk_cols:
            bk_alters.append("ADD COLUMN decision_reason TEXT NULL")
        if "reviewed_by" not in bk_cols:
            bk_alters.append("ADD COLUMN reviewed_by VARCHAR(100) NULL")
        if "reviewed_at" not in bk_cols:
            bk_alters.append("ADD COLUMN reviewed_at DATETIME NULL")
        if bk_alters:
            with engine.begin() as conn:
                for stmt in bk_alters:
                    try:
                        conn.execute(text(f"ALTER TABLE taco_testing_bookings {stmt}"))
                    except Exception as exc:
                        print(f"[TACO-FMMS] booking column migrate skipped: {exc}")
            print(f"[TACO-FMMS] taco_testing_bookings columns migrated ({len(bk_alters)} added)")


def _backfill_pending_reasons(db: Session):
    """Ensure existing pending vendors have a visible reason."""
    rows = db.query(TacoVendor).filter(
        TacoVendor.status == "pending",
        (TacoVendor.pending_reason.is_(None) | (TacoVendor.pending_reason == "")),
    ).all()
    if not rows:
        return
    for row in rows:
        row.pending_reason = "Awaiting QA / procurement approval — accreditation documents under review"
    db.commit()


def _seed_if_empty(db: Session):
    if db.query(TacoVendor).count() > 0:
        _backfill_pending_reasons(db)
        return

    vendors = [
        TacoVendor(
            vendor_code="VND-NABL-01", name="Precision Metrology Labs", vendor_type="calibration_lab",
            accreditation="NABL", contact_email="cal@pmlabs.example", contact_phone="+91-20-4000-1001",
            city="Pune", status="approved", rating=4.6, turnaround_days=5,
        ),
        TacoVendor(
            vendor_code="VND-NABL-02", name="Accurate Instruments India", vendor_type="calibration_lab",
            accreditation="NABL", contact_email="ops@accurate.example", contact_phone="+91-44-4000-2002",
            city="Chennai", status="approved", rating=4.3, turnaround_days=7,
        ),
        TacoVendor(
            vendor_code="VND-OEM-01", name="Mitutoyo Service Center", vendor_type="oem",
            accreditation="ISO/IEC 17025", contact_email="service@mitutoyo.example", contact_phone="+91-80-4000-3003",
            city="Bengaluru", status="approved", rating=4.8, turnaround_days=10,
        ),
        TacoVendor(
            vendor_code="VND-SVC-01", name="Titan Calibration Partners", vendor_type="service",
            accreditation="NABL", contact_email="help@tcp.example", contact_phone="+91-120-4000-4004",
            city="Noida", status="pending", rating=3.9, turnaround_days=6,
            pending_reason="NABL scope certificate for dimensional metrology not yet verified by QA",
        ),
    ]
    db.add_all(vendors)
    db.flush()

    maps = [
        TacoVendorEquipmentMap(vendor_id=vendors[0].id, asset_code="AST-CMM-01", equipment_type="CMM", business_unit="Interior Systems", preferred=True),
        TacoVendorEquipmentMap(vendor_id=vendors[0].id, asset_code="AST-MIC-12", equipment_type="Micrometer", business_unit="Lighting Systems", preferred=True),
        TacoVendorEquipmentMap(vendor_id=vendors[1].id, asset_code="AST-HG-04", equipment_type="Height Gauge", business_unit="Seating Systems", preferred=True),
        TacoVendorEquipmentMap(vendor_id=vendors[2].id, asset_code="AST-SR-02", equipment_type="Surface Roughness Tester", business_unit="HVAC Systems", preferred=True),
    ]
    db.add_all(maps)

    rates = [
        TacoVendorRateCard(vendor_id=vendors[0].id, service_name="CMM Calibration", equipment_type="CMM", unit_rate=18500, lead_time_days=5, effective_from=date(2026, 1, 1)),
        TacoVendorRateCard(vendor_id=vendors[0].id, service_name="Micrometer Set Cal", equipment_type="Micrometer", unit_rate=2200, lead_time_days=3, effective_from=date(2026, 1, 1)),
        TacoVendorRateCard(vendor_id=vendors[1].id, service_name="Height Gauge Cal", equipment_type="Height Gauge", unit_rate=4500, lead_time_days=5, effective_from=date(2026, 1, 1)),
        TacoVendorRateCard(vendor_id=vendors[2].id, service_name="OEM Roughness Cal", equipment_type="Surface Roughness Tester", unit_rate=9800, lead_time_days=8, effective_from=date(2026, 1, 1)),
    ]
    db.add_all(rates)

    today = date.today()
    workflows = [
        TacoVendorWorkflow(
            workflow_number="VW-2026-001", asset_code="AST-CMM-01", asset_name="Zeiss CMM Contura",
            business_unit="Interior Systems", vendor_id=vendors[0].id, vendor_name=vendors[0].name,
            stage="notify", status="open", notified_at=datetime.now(), pickup_date=today + timedelta(days=2),
            expected_return=today + timedelta(days=7), estimated_cost=18500, created_by="system",
        ),
        TacoVendorWorkflow(
            workflow_number="VW-2026-002", asset_code="AST-MIC-12", asset_name="Digital Micrometer Kit",
            business_unit="Lighting Systems", vendor_id=vendors[0].id, vendor_name=vendors[0].name,
            stage="pickup", status="in_progress", notified_at=datetime.now() - timedelta(days=3),
            pickup_date=today - timedelta(days=1), expected_return=today + timedelta(days=4),
            estimated_cost=2200, created_by="qc.lead",
        ),
        TacoVendorWorkflow(
            workflow_number="VW-2026-003", asset_code="AST-HG-04", asset_name="Mitutoyo Height Gauge",
            business_unit="Seating Systems", vendor_id=vendors[1].id, vendor_name=vendors[1].name,
            stage="at_lab", status="in_progress", notified_at=datetime.now() - timedelta(days=8),
            pickup_date=today - timedelta(days=6), expected_return=today + timedelta(days=1),
            estimated_cost=4500, created_by="maint.sup",
        ),
        TacoVendorWorkflow(
            workflow_number="VW-2026-004", asset_code="AST-SR-02", asset_name="Surftest SJ-210",
            business_unit="HVAC Systems", vendor_id=vendors[2].id, vendor_name=vendors[2].name,
            stage="return", status="in_progress", notified_at=datetime.now() - timedelta(days=12),
            pickup_date=today - timedelta(days=10), expected_return=today, actual_return=today,
            estimated_cost=9800, actual_cost=9800, created_by="qa.mgr",
        ),
    ]
    db.add_all(workflows)

    month = today.strftime("%Y-%m")
    prev = (today.replace(day=1) - timedelta(days=1)).strftime("%Y-%m")
    costs = [
        TacoCalibrationCost(period_month=month, business_unit="Interior Systems", asset_code="AST-CMM-01", vendor_name=vendors[0].name, cost_amount=18500),
        TacoCalibrationCost(period_month=month, business_unit="Lighting Systems", asset_code="AST-MIC-12", vendor_name=vendors[0].name, cost_amount=2200),
        TacoCalibrationCost(period_month=month, business_unit="Seating Systems", asset_code="AST-HG-04", vendor_name=vendors[1].name, cost_amount=4500),
        TacoCalibrationCost(period_month=month, business_unit="HVAC Systems", asset_code="AST-SR-02", vendor_name=vendors[2].name, cost_amount=9800, cost_type="urgent"),
        TacoCalibrationCost(period_month=prev, business_unit="Interior Systems", asset_code="AST-PP-01", vendor_name=vendors[0].name, cost_amount=12000),
        TacoCalibrationCost(period_month=prev, business_unit="Electronics", asset_code="AST-VM-03", vendor_name=vendors[1].name, cost_amount=7600),
        TacoCalibrationCost(period_month=prev, business_unit="Composites", asset_code="AST-HT-01", vendor_name=vendors[2].name, cost_amount=15400),
    ]
    db.add_all(costs)

    equipment = [
        TacoTestingEquipment(equipment_code="TE-CMM-01", name="Zeiss Contura CMM", equipment_type="CMM", owning_bu="Interior Systems", location="Metrology Lab A", status="available", utilization_pct=62, capacity_slots_per_day=3, duration_options_min="60,120,180", default_duration_min=120, cost_per_hour=3500),
        TacoTestingEquipment(equipment_code="TE-VMS-02", name="Vision Measuring System", equipment_type="VMS", owning_bu="Lighting Systems", location="QA Lab B", status="booked", utilization_pct=78, capacity_slots_per_day=4, duration_options_min="30,60,90", default_duration_min=60, cost_per_hour=2200),
        TacoTestingEquipment(equipment_code="TE-HT-03", name="Hardness Tester", equipment_type="Hardness", owning_bu="Seating Systems", location="Material Lab", status="available", utilization_pct=45, capacity_slots_per_day=6, duration_options_min="30,60", default_duration_min=30, cost_per_hour=800),
        TacoTestingEquipment(equipment_code="TE-PP-04", name="Profile Projector", equipment_type="Projector", owning_bu="HVAC Systems", location="Metrology Lab C", status="available", utilization_pct=55, capacity_slots_per_day=5, duration_options_min="30,60,120", default_duration_min=60, cost_per_hour=1200),
        TacoTestingEquipment(equipment_code="TE-SR-05", name="Surface Roughness Tester", equipment_type="Roughness", owning_bu="Electronics", location="Electronics Lab", status="calibration", utilization_pct=30, capacity_slots_per_day=4, shareable=False, duration_options_min="30,60", default_duration_min=30, cost_per_hour=900),
        TacoTestingEquipment(equipment_code="TE-CMM-06", name="Hexagon Global CMM", equipment_type="CMM", owning_bu="Composites", location="Composites Lab", status="available", utilization_pct=70, capacity_slots_per_day=3, duration_options_min="60,120,240", default_duration_min=120, cost_per_hour=4000),
    ]
    db.add_all(equipment)
    db.flush()

    bookings = [
        TacoTestingBooking(
            booking_number="BK-2026-001", equipment_id=equipment[1].id, equipment_code=equipment[1].equipment_code,
            equipment_name=equipment[1].name, owning_bu=equipment[1].owning_bu, requesting_bu="Interior Systems",
            requested_by="qa.interior", booking_date=today, slot_start="09:00", slot_end="11:00",
            priority="normal", status="confirmed", purpose="Incoming part dimensional check",
        ),
        TacoTestingBooking(
            booking_number="BK-2026-002", equipment_id=equipment[0].id, equipment_code=equipment[0].equipment_code,
            equipment_name=equipment[0].name, owning_bu=equipment[0].owning_bu, requesting_bu="Interior Systems",
            requested_by="metrology.lead", booking_date=today + timedelta(days=1), slot_start="10:00", slot_end="13:00",
            priority="owner_priority", status="confirmed", purpose="PPAP sample verification",
        ),
        TacoTestingBooking(
            booking_number="BK-2026-003", equipment_id=equipment[2].id, equipment_code=equipment[2].equipment_code,
            equipment_name=equipment[2].name, owning_bu=equipment[2].owning_bu, requesting_bu="Lighting Systems",
            requested_by="qa.lighting", booking_date=today + timedelta(days=2), slot_start="14:00", slot_end="15:00",
            priority="normal", status="requested", purpose="Material hardness sample",
        ),
        TacoTestingBooking(
            booking_number="BK-2026-004", equipment_id=equipment[5].id, equipment_code=equipment[5].equipment_code,
            equipment_name=equipment[5].name, owning_bu=equipment[5].owning_bu, requesting_bu="HVAC Systems",
            requested_by="eng.hvac", booking_date=today + timedelta(days=3), slot_start="09:00", slot_end="12:00",
            priority="normal", status="requested", purpose="Cross-BU fixture validation",
        ),
    ]
    db.add_all(bookings)

    rules = [
        TacoReservationRule(rule_name="Owner BU 48h hold", owning_bu="Interior Systems", priority_window_hours=48, max_external_share_pct=35, auto_approve_owner=True),
        TacoReservationRule(rule_name="Lighting share cap", owning_bu="Lighting Systems", priority_window_hours=36, max_external_share_pct=40, auto_approve_owner=True),
        TacoReservationRule(rule_name="Seating default", owning_bu="Seating Systems", priority_window_hours=24, max_external_share_pct=50, auto_approve_owner=True),
    ]
    db.add_all(rules)
    db.commit()
    print("[TACO-FMMS] Seed data loaded")


_ensure_taco_tables()


def _ready(db: Session):
    _ensure_taco_tables()
    _seed_if_empty(db)
    _backfill_pending_reasons(db)
    # duration/cost defaults for older testing equipment rows
    try:
        rows = db.query(TacoTestingEquipment).all()
        changed = False
        for row in rows:
            if not getattr(row, "duration_options_min", None):
                row.duration_options_min = "30,60,120"
                changed = True
            if not getattr(row, "default_duration_min", None):
                row.default_duration_min = 60
                changed = True
            if not getattr(row, "day_start", None):
                row.day_start = "09:00"
                changed = True
            if not getattr(row, "day_end", None):
                row.day_end = "18:00"
                changed = True
            if getattr(row, "cost_per_hour", None) is None:
                row.cost_per_hour = 0
                changed = True
        if changed:
            db.commit()
    except Exception:
        pass


# ── helpers / serializers ───────────────────────────────────────────────────

def _vendor_dict(v: TacoVendor) -> dict[str, Any]:
    return {
        "id": v.id, "vendor_code": v.vendor_code, "name": v.name, "vendor_type": v.vendor_type,
        "accreditation": v.accreditation, "contact_email": v.contact_email, "contact_phone": v.contact_phone,
        "city": v.city, "status": v.status, "rating": float(v.rating or 0),
        "turnaround_days": v.turnaround_days,
        "pending_reason": getattr(v, "pending_reason", None),
        "decision_reason": getattr(v, "decision_reason", None),
        "reviewed_by": getattr(v, "reviewed_by", None),
        "reviewed_at": str(v.reviewed_at) if getattr(v, "reviewed_at", None) else None,
        "notes": v.notes,
    }


def _workflow_dict(w: TacoVendorWorkflow) -> dict[str, Any]:
    return {
        "id": w.id, "workflow_number": w.workflow_number, "asset_code": w.asset_code,
        "asset_name": w.asset_name, "business_unit": w.business_unit, "vendor_id": w.vendor_id,
        "vendor_name": w.vendor_name, "stage": w.stage, "status": w.status,
        "notified_at": str(w.notified_at) if w.notified_at else None,
        "pickup_date": str(w.pickup_date) if w.pickup_date else None,
        "expected_return": str(w.expected_return) if w.expected_return else None,
        "actual_return": str(w.actual_return) if w.actual_return else None,
        "estimated_cost": float(w.estimated_cost or 0), "actual_cost": float(w.actual_cost or 0),
        "remarks": w.remarks, "created_by": w.created_by,
    }


def _parse_durations(raw: Optional[str], default: int = 60) -> list[int]:
    vals = []
    for part in str(raw or "").split(","):
        part = part.strip()
        if not part:
            continue
        try:
            n = int(part)
            if n > 0:
                vals.append(n)
        except ValueError:
            continue
    return vals or [default]


def _hhmm_to_min(hhmm: str) -> int:
    h, m = str(hhmm or "09:00").split(":")[:2]
    return int(h) * 60 + int(m)


def _min_to_hhmm(total: int) -> str:
    h, m = divmod(total, 60)
    return f"{h:02d}:{m:02d}"


def _ranges_overlap(a0: int, a1: int, b0: int, b1: int) -> bool:
    return a0 < b1 and b0 < a1


def _equipment_dict(e: TacoTestingEquipment) -> dict[str, Any]:
    durations = _parse_durations(getattr(e, "duration_options_min", None), getattr(e, "default_duration_min", None) or 60)
    return {
        "id": e.id, "equipment_code": e.equipment_code, "name": e.name,
        "equipment_type": e.equipment_type, "owning_bu": e.owning_bu, "location": e.location,
        "status": e.status, "utilization_pct": float(e.utilization_pct or 0),
        "shareable": bool(e.shareable), "capacity_slots_per_day": e.capacity_slots_per_day,
        "duration_options_min": durations,
        "default_duration_min": int(getattr(e, "default_duration_min", None) or durations[0]),
        "day_start": getattr(e, "day_start", None) or "09:00",
        "day_end": getattr(e, "day_end", None) or "18:00",
        "cost_per_hour": float(getattr(e, "cost_per_hour", None) or 0),
        "notes": e.notes,
    }


def _booking_dict(b: TacoTestingBooking) -> dict[str, Any]:
    return {
        "id": b.id, "booking_number": b.booking_number, "equipment_id": b.equipment_id,
        "equipment_code": b.equipment_code, "equipment_name": b.equipment_name,
        "owning_bu": b.owning_bu, "requesting_bu": b.requesting_bu, "requested_by": b.requested_by,
        "booking_date": str(b.booking_date) if b.booking_date else None,
        "slot_start": b.slot_start, "slot_end": b.slot_end,
        "duration_min": int(getattr(b, "duration_min", None) or 60),
        "asset_under_test": getattr(b, "asset_under_test", None),
        "asset_under_test_name": getattr(b, "asset_under_test_name", None),
        "fmms_wo_number": getattr(b, "fmms_wo_number", None),
        "cost_amount": float(getattr(b, "cost_amount", None) or 0),
        "priority": b.priority, "status": b.status, "purpose": b.purpose,
        "submitted_at": str(getattr(b, "submitted_at", None) or b.created_at or "") or None,
        "decision_reason": getattr(b, "decision_reason", None),
        "reviewed_by": getattr(b, "reviewed_by", None),
        "reviewed_at": str(getattr(b, "reviewed_at", None) or "") or None,
    }


# ── meta / dashboard ────────────────────────────────────────────────────────

@router.get("/meta")
def taco_meta(db: Session = Depends(get_db), user=Depends(get_current_user)):
    _ready(db)
    return {"business_units": BUSINESS_UNITS, "group": "TATA AutoComp"}


@router.get("/dashboard")
def taco_management_dashboard(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """MGT-01..07 centralized monitoring KPIs."""
    _ready(db)
    today = date.today()
    assets = db.query(FmmsAsset).filter(FmmsAsset.next_service_date.isnot(None)).all()
    total_cal = len(assets) or 1
    overdue = sum(1 for a in assets if a.next_service_date and a.next_service_date < today)
    due_soon = sum(
        1 for a in assets
        if a.next_service_date and today <= a.next_service_date <= today + timedelta(days=int(a.alert_before_days or 7))
    )
    on_track = max(0, total_cal - overdue - due_soon)
    compliance_pct = round(100.0 * on_track / total_cal, 1)

    equipment = db.query(TacoTestingEquipment).all()
    util = round(sum(float(e.utilization_pct or 0) for e in equipment) / max(len(equipment), 1), 1)
    available = sum(1 for e in equipment if e.status == "available")
    booked = sum(1 for e in equipment if e.status == "booked")

    bookings = db.query(TacoTestingBooking).all()
    open_requests = sum(1 for b in bookings if b.status in ("requested", "confirmed"))
    cross_bu = sum(1 for b in bookings if b.owning_bu and b.requesting_bu and b.owning_bu != b.requesting_bu)

    month = today.strftime("%Y-%m")
    month_cost = db.query(func.coalesce(func.sum(TacoCalibrationCost.cost_amount), 0)).filter(
        TacoCalibrationCost.period_month == month
    ).scalar() or 0
    prev = (today.replace(day=1) - timedelta(days=1)).strftime("%Y-%m")
    prev_cost = db.query(func.coalesce(func.sum(TacoCalibrationCost.cost_amount), 0)).filter(
        TacoCalibrationCost.period_month == prev
    ).scalar() or 0
    savings = max(0, float(prev_cost) - float(month_cost))

    vendors = db.query(TacoVendor).filter(TacoVendor.status == "approved").all()
    avg_rating = round(sum(float(v.rating or 0) for v in vendors) / max(len(vendors), 1), 2)

    bu_summary = []
    for bu in BUSINESS_UNITS:
        bu_eq = [e for e in equipment if e.owning_bu == bu]
        bu_cost = db.query(func.coalesce(func.sum(TacoCalibrationCost.cost_amount), 0)).filter(
            TacoCalibrationCost.period_month == month,
            TacoCalibrationCost.business_unit == bu,
        ).scalar() or 0
        bu_summary.append({
            "business_unit": bu,
            "equipment_count": len(bu_eq),
            "avg_utilization": round(sum(float(e.utilization_pct or 0) for e in bu_eq) / max(len(bu_eq), 1), 1),
            "calibration_cost": float(bu_cost),
            "open_bookings": sum(1 for b in bookings if b.requesting_bu == bu and b.status in ("requested", "confirmed")),
        })

    return {
        "group": "TATA AutoComp",
        "calibration_compliance_pct": compliance_pct,
        "calibration_overdue": overdue,
        "calibration_due_soon": due_soon,
        "equipment_utilization_pct": util,
        "equipment_available": available,
        "equipment_booked": booked,
        "testing_requests_open": open_requests,
        "cost_savings_inr": savings,
        "month_calibration_cost": float(month_cost),
        "prev_month_calibration_cost": float(prev_cost),
        "vendor_avg_rating": avg_rating,
        "approved_vendors": len(vendors),
        "cross_bu_bookings": cross_bu,
        "bu_summary": bu_summary,
    }


# ── vendors ─────────────────────────────────────────────────────────────────

@router.get("/vendors")
def list_vendors(
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    _ready(db)
    q = db.query(TacoVendor)
    if status:
        q = q.filter(TacoVendor.status == status)
    return [_vendor_dict(v) for v in q.order_by(TacoVendor.name).all()]


class VendorIn(BaseModel):
    vendor_code: str
    name: str
    vendor_type: str = "calibration_lab"
    accreditation: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    city: Optional[str] = None
    status: str = "pending"
    rating: float = 0
    turnaround_days: int = 7
    pending_reason: Optional[str] = None
    notes: Optional[str] = None


@router.post("/vendors")
def create_vendor(data: VendorIn, db: Session = Depends(get_db), user=Depends(get_current_user)):
    _ready(db)
    if db.query(TacoVendor).filter(TacoVendor.vendor_code == data.vendor_code).first():
        raise HTTPException(400, "vendor_code already exists")
    status = (data.status or "pending").strip().lower()
    if status not in ("approved", "pending", "rejected", "suspended"):
        raise HTTPException(400, "Invalid status")
    if status == "pending" and not (data.pending_reason or "").strip():
        raise HTTPException(400, "pending_reason is required when status is pending")
    payload = data.model_dump()
    payload["status"] = status
    if status != "pending":
        payload["pending_reason"] = data.pending_reason
    row = TacoVendor(**payload)
    db.add(row)
    db.commit()
    db.refresh(row)
    return _vendor_dict(row)


class VendorDecisionIn(BaseModel):
    action: str  # approve | reject
    decision_reason: Optional[str] = None


@router.patch("/vendors/{vendor_id}/decision")
def decide_vendor(
    vendor_id: int,
    data: VendorDecisionIn,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Approve or reject a pending vendor (CAL-10 control)."""
    _ready(db)
    row = db.query(TacoVendor).filter(TacoVendor.id == vendor_id).first()
    if not row:
        raise HTTPException(404, "Vendor not found")
    action = (data.action or "").strip().lower()
    if action not in ("approve", "reject"):
        raise HTTPException(400, "action must be approve or reject")
    if action == "reject" and not (data.decision_reason or "").strip():
        raise HTTPException(400, "decision_reason is required when rejecting")

    if action == "approve":
        row.status = "approved"
        row.decision_reason = (data.decision_reason or "").strip() or "Approved for calibration vendor panel"
    else:
        row.status = "rejected"
        row.decision_reason = (data.decision_reason or "").strip()

    row.reviewed_by = getattr(user, "username", None) or "user"
    row.reviewed_at = datetime.now()
    db.commit()
    db.refresh(row)
    return _vendor_dict(row)


@router.get("/vendor-mappings")
def list_vendor_mappings(db: Session = Depends(get_db), user=Depends(get_current_user)):
    _ready(db)
    rows = db.query(TacoVendorEquipmentMap).order_by(TacoVendorEquipmentMap.id.desc()).all()
    vendors = {v.id: v.name for v in db.query(TacoVendor).all()}
    return [{
        "id": m.id, "vendor_id": m.vendor_id, "vendor_name": vendors.get(m.vendor_id, "—"),
        "asset_code": m.asset_code, "equipment_type": m.equipment_type,
        "business_unit": m.business_unit, "preferred": bool(m.preferred), "remarks": m.remarks,
    } for m in rows]


class MappingIn(BaseModel):
    vendor_id: int
    asset_code: Optional[str] = None
    equipment_type: Optional[str] = None
    business_unit: Optional[str] = None
    preferred: bool = True
    remarks: Optional[str] = None


@router.post("/vendor-mappings")
def create_mapping(data: MappingIn, db: Session = Depends(get_db), user=Depends(get_current_user)):
    _ready(db)
    if not db.query(TacoVendor).filter(TacoVendor.id == data.vendor_id).first():
        raise HTTPException(404, "Vendor not found")
    row = TacoVendorEquipmentMap(**data.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "ok": True}


@router.get("/rate-cards")
def list_rate_cards(db: Session = Depends(get_db), user=Depends(get_current_user)):
    _ready(db)
    rows = db.query(TacoVendorRateCard).order_by(TacoVendorRateCard.equipment_type).all()
    vendors = {v.id: v.name for v in db.query(TacoVendor).all()}
    return [{
        "id": r.id, "vendor_id": r.vendor_id, "vendor_name": vendors.get(r.vendor_id, "—"),
        "service_name": r.service_name, "equipment_type": r.equipment_type,
        "unit_rate": float(r.unit_rate or 0), "currency": r.currency,
        "lead_time_days": r.lead_time_days,
        "effective_from": str(r.effective_from) if r.effective_from else None,
        "status": r.status,
    } for r in rows]


class RateCardIn(BaseModel):
    vendor_id: int
    service_name: str
    equipment_type: Optional[str] = None
    unit_rate: float = 0
    currency: str = "INR"
    lead_time_days: int = 7
    effective_from: Optional[date] = None
    status: str = "active"


@router.post("/rate-cards")
def create_rate_card(data: RateCardIn, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """CAL-11 — manually enter negotiated vendor rate (not auto-calculated)."""
    _ready(db)
    vendor = db.query(TacoVendor).filter(TacoVendor.id == data.vendor_id).first()
    if not vendor:
        raise HTTPException(404, "Vendor not found")
    if data.unit_rate < 0:
        raise HTTPException(400, "unit_rate must be >= 0")
    row = TacoVendorRateCard(
        vendor_id=data.vendor_id,
        service_name=data.service_name.strip(),
        equipment_type=(data.equipment_type or "").strip() or None,
        unit_rate=float(data.unit_rate),
        currency=data.currency or "INR",
        lead_time_days=max(1, int(data.lead_time_days or 7)),
        effective_from=data.effective_from or date.today(),
        status=data.status or "active",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {
        "id": row.id,
        "vendor_id": row.vendor_id,
        "vendor_name": vendor.name,
        "service_name": row.service_name,
        "equipment_type": row.equipment_type,
        "unit_rate": float(row.unit_rate or 0),
        "currency": row.currency,
        "lead_time_days": row.lead_time_days,
        "effective_from": str(row.effective_from) if row.effective_from else None,
        "status": row.status,
    }


# ── vendor workflow ─────────────────────────────────────────────────────────

@router.get("/workflows")
def list_workflows(
    stage: Optional[str] = None,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    _ready(db)
    q = db.query(TacoVendorWorkflow)
    if stage:
        q = q.filter(TacoVendorWorkflow.stage == stage)
    return [_workflow_dict(w) for w in q.order_by(TacoVendorWorkflow.id.desc()).all()]


class WorkflowIn(BaseModel):
    asset_code: str
    asset_name: Optional[str] = None
    business_unit: Optional[str] = None
    vendor_id: int
    pickup_date: Optional[date] = None
    expected_return: Optional[date] = None
    estimated_cost: float = 0
    remarks: Optional[str] = None


@router.post("/workflows")
def create_workflow(data: WorkflowIn, db: Session = Depends(get_db), user=Depends(get_current_user)):
    _ready(db)
    vendor = db.query(TacoVendor).filter(TacoVendor.id == data.vendor_id).first()
    if not vendor:
        raise HTTPException(404, "Vendor not found")
    n = db.query(TacoVendorWorkflow).count() + 1
    row = TacoVendorWorkflow(
        workflow_number=f"VW-{date.today().year}-{n:03d}",
        asset_code=data.asset_code,
        asset_name=data.asset_name or data.asset_code,
        business_unit=data.business_unit,
        vendor_id=vendor.id,
        vendor_name=vendor.name,
        stage="notify",
        status="open",
        notified_at=datetime.now(),
        pickup_date=data.pickup_date,
        expected_return=data.expected_return,
        estimated_cost=data.estimated_cost,
        remarks=data.remarks,
        created_by=getattr(user, "username", None) or "user",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _workflow_dict(row)


class WorkflowStageIn(BaseModel):
    stage: str
    status: Optional[str] = None
    actual_return: Optional[date] = None
    actual_cost: Optional[float] = None
    remarks: Optional[str] = None


@router.patch("/workflows/{workflow_id}")
def advance_workflow(
    workflow_id: int,
    data: WorkflowStageIn,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    _ready(db)
    row = db.query(TacoVendorWorkflow).filter(TacoVendorWorkflow.id == workflow_id).first()
    if not row:
        raise HTTPException(404, "Workflow not found")
    allowed = {"notify", "pickup", "at_lab", "return", "closed"}
    if data.stage not in allowed:
        raise HTTPException(400, f"stage must be one of {sorted(allowed)}")
    row.stage = data.stage
    if data.status:
        row.status = data.status
    elif data.stage == "closed":
        row.status = "completed"
    elif data.stage != "notify":
        row.status = "in_progress"
    if data.actual_return:
        row.actual_return = data.actual_return
    if data.actual_cost is not None:
        row.actual_cost = data.actual_cost
    if data.remarks is not None:
        row.remarks = data.remarks
    db.commit()
    db.refresh(row)
    return _workflow_dict(row)


# ── calibration costs ───────────────────────────────────────────────────────

@router.get("/calibration-costs")
def calibration_costs(
    period_month: Optional[str] = None,
    business_unit: Optional[str] = None,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    _ready(db)
    q = db.query(TacoCalibrationCost)
    if period_month:
        q = q.filter(TacoCalibrationCost.period_month == period_month)
    if business_unit:
        q = q.filter(TacoCalibrationCost.business_unit == business_unit)
    rows = q.order_by(TacoCalibrationCost.period_month.desc(), TacoCalibrationCost.business_unit).all()
    items = [{
        "id": c.id, "period_month": c.period_month, "business_unit": c.business_unit,
        "group_name": c.group_name, "asset_code": c.asset_code, "vendor_name": c.vendor_name,
        "cost_amount": float(c.cost_amount or 0), "cost_type": c.cost_type, "remarks": c.remarks,
    } for c in rows]

    by_bu: dict[str, float] = {}
    for c in items:
        by_bu[c["business_unit"]] = by_bu.get(c["business_unit"], 0) + c["cost_amount"]
    return {
        "items": items,
        "by_bu": [{"business_unit": k, "total_cost": v} for k, v in sorted(by_bu.items())],
        "group_total": sum(c["cost_amount"] for c in items),
    }


# ── testing equipment ───────────────────────────────────────────────────────

@router.get("/testing-equipment")
def list_testing_equipment(
    business_unit: Optional[str] = None,
    search: Optional[str] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    _ready(db)
    q = db.query(TacoTestingEquipment)
    if business_unit:
        q = q.filter(TacoTestingEquipment.owning_bu == business_unit)
    if status:
        q = q.filter(TacoTestingEquipment.status == status)
    if search:
        like = f"%{search}%"
        q = q.filter(
            (TacoTestingEquipment.name.ilike(like))
            | (TacoTestingEquipment.equipment_code.ilike(like))
            | (TacoTestingEquipment.equipment_type.ilike(like))
            | (TacoTestingEquipment.location.ilike(like))
        )
    return [_equipment_dict(e) for e in q.order_by(TacoTestingEquipment.owning_bu, TacoTestingEquipment.name).all()]


class TestingEquipmentIn(BaseModel):
    equipment_code: str
    name: str
    equipment_type: Optional[str] = None
    owning_bu: str
    location: Optional[str] = None
    status: str = "available"
    shareable: bool = True
    duration_options_min: str = "30,60,120"
    default_duration_min: int = 60
    day_start: str = "09:00"
    day_end: str = "18:00"
    cost_per_hour: float = 0
    capacity_slots_per_day: int = 4
    notes: Optional[str] = None


@router.post("/testing-equipment")
def create_testing_equipment(data: TestingEquipmentIn, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Configure testing equipment durations / cost for booking."""
    _ready(db)
    if db.query(TacoTestingEquipment).filter(TacoTestingEquipment.equipment_code == data.equipment_code).first():
        raise HTTPException(400, "equipment_code already exists")
    durations = _parse_durations(data.duration_options_min, data.default_duration_min or 60)
    default_dur = int(data.default_duration_min or durations[0])
    if default_dur not in durations:
        durations = sorted(set(durations + [default_dur]))
    row = TacoTestingEquipment(
        equipment_code=data.equipment_code.strip(),
        name=data.name.strip(),
        equipment_type=data.equipment_type,
        owning_bu=data.owning_bu,
        location=data.location,
        status=data.status or "available",
        shareable=bool(data.shareable),
        duration_options_min=",".join(str(x) for x in durations),
        default_duration_min=default_dur,
        day_start=data.day_start or "09:00",
        day_end=data.day_end or "18:00",
        cost_per_hour=float(data.cost_per_hour or 0),
        capacity_slots_per_day=int(data.capacity_slots_per_day or 4),
        notes=data.notes,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _equipment_dict(row)


class TestingEquipmentUpdateIn(BaseModel):
    duration_options_min: Optional[str] = None
    default_duration_min: Optional[int] = None
    day_start: Optional[str] = None
    day_end: Optional[str] = None
    cost_per_hour: Optional[float] = None
    status: Optional[str] = None
    shareable: Optional[bool] = None
    location: Optional[str] = None
    notes: Optional[str] = None


@router.patch("/testing-equipment/{equipment_id}")
def update_testing_equipment(
    equipment_id: int,
    data: TestingEquipmentUpdateIn,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    _ready(db)
    row = db.query(TacoTestingEquipment).filter(TacoTestingEquipment.id == equipment_id).first()
    if not row:
        raise HTTPException(404, "Equipment not found")
    payload = data.model_dump(exclude_unset=True)
    if "duration_options_min" in payload and payload["duration_options_min"] is not None:
        durs = _parse_durations(payload["duration_options_min"], row.default_duration_min or 60)
        payload["duration_options_min"] = ",".join(str(x) for x in durs)
    for k, v in payload.items():
        setattr(row, k, v)
    db.commit()
    db.refresh(row)
    return _equipment_dict(row)


@router.get("/utilization")
def utilization_summary(db: Session = Depends(get_db), user=Depends(get_current_user)):
    _ready(db)
    rows = db.query(TacoTestingEquipment).all()
    by_bu = {}
    for e in rows:
        bucket = by_bu.setdefault(e.owning_bu, {"business_unit": e.owning_bu, "count": 0, "util_sum": 0, "available": 0, "booked": 0})
        bucket["count"] += 1
        bucket["util_sum"] += float(e.utilization_pct or 0)
        if e.status == "available":
            bucket["available"] += 1
        if e.status == "booked":
            bucket["booked"] += 1
    return {
        "overall_utilization_pct": round(sum(float(e.utilization_pct or 0) for e in rows) / max(len(rows), 1), 1),
        "by_bu": [{
            "business_unit": v["business_unit"],
            "equipment_count": v["count"],
            "avg_utilization_pct": round(v["util_sum"] / max(v["count"], 1), 1),
            "available": v["available"],
            "booked": v["booked"],
        } for v in by_bu.values()],
        "items": [_equipment_dict(e) for e in rows],
    }


# ── bookings ────────────────────────────────────────────────────────────────

@router.get("/bookings")
def list_bookings(
    business_unit: Optional[str] = None,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    _ready(db)
    q = db.query(TacoTestingBooking)
    if business_unit:
        q = q.filter(
            (TacoTestingBooking.requesting_bu == business_unit)
            | (TacoTestingBooking.owning_bu == business_unit)
        )
    if from_date:
        q = q.filter(TacoTestingBooking.booking_date >= from_date)
    if to_date:
        q = q.filter(TacoTestingBooking.booking_date <= to_date)
    return [_booking_dict(b) for b in q.order_by(TacoTestingBooking.booking_date, TacoTestingBooking.slot_start).all()]


@router.get("/slots")
def available_slots(
    booking_date: date = Query(...),
    duration_min: Optional[int] = Query(None, ge=15, le=480),
    equipment_id: Optional[int] = None,
    business_unit: Optional[str] = None,
    requesting_bu: Optional[str] = None,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Generate availability; apply TEST-09 rules for external requesting BUs."""
    _ready(db)
    q = db.query(TacoTestingEquipment).filter(TacoTestingEquipment.shareable.is_(True))
    if equipment_id:
        q = q.filter(TacoTestingEquipment.id == equipment_id)
    if business_unit:
        q = q.filter(TacoTestingEquipment.owning_bu == business_unit)
    equipment = q.all()
    existing = db.query(TacoTestingBooking).filter(
        TacoTestingBooking.booking_date == booking_date,
        TacoTestingBooking.status.in_(["requested", "confirmed", "in_use"]),
    ).all()
    booked_by_eq: dict[int, list] = {}
    for b in existing:
        booked_by_eq.setdefault(b.equipment_id, []).append(b)

    rules = {
        r.owning_bu: r
        for r in db.query(TacoReservationRule).filter(TacoReservationRule.active.is_(True)).all()
    }
    now = datetime.now()

    result = []
    for e in equipment:
        allowed = _parse_durations(getattr(e, "duration_options_min", None), getattr(e, "default_duration_min", None) or 60)
        use_dur = int(duration_min or getattr(e, "default_duration_min", None) or allowed[0])
        if use_dur not in allowed:
            use_dur = allowed[0]
        day0 = _hhmm_to_min(getattr(e, "day_start", None) or "09:00")
        day1 = _hhmm_to_min(getattr(e, "day_end", None) or "18:00")
        taken_ranges = []
        for b in booked_by_eq.get(e.id, []):
            taken_ranges.append((
                _hhmm_to_min(b.slot_start),
                _hhmm_to_min(b.slot_end),
                b,
            ))

        step = min(30, use_dur) if use_dur >= 30 else use_dur
        eq_blocked = str(e.status or "").lower() in ("maintenance", "calibration")

        total_slots = 0
        tcount = day0
        while tcount + use_dur <= day1:
            total_slots += 1
            tcount += step
        total_slots = max(total_slots, 1)

        day_bookings = booked_by_eq.get(e.id, [])
        external_count = sum(
            1 for b in day_bookings
            if b.requesting_bu and b.owning_bu and b.requesting_bu != b.owning_bu
        )
        rule = rules.get(e.owning_bu)
        max_ext_pct = float(getattr(rule, "max_external_share_pct", None) or 100)
        priority_hours = int(getattr(rule, "priority_window_hours", None) or 0)
        max_ext_slots = int((max_ext_pct / 100.0) * total_slots)
        external_cap_reached = external_count >= max_ext_slots

        is_owner_request = bool(requesting_bu and requesting_bu == e.owning_bu)
        is_external_request = bool(requesting_bu and requesting_bu != e.owning_bu)
        request_type = "owner" if is_owner_request else ("external" if is_external_request else "viewer")

        slots = []
        t = day0
        while t + use_dur <= day1:
            end = t + use_dur
            hit = next((b for a0, a1, b in taken_ranges if _ranges_overlap(t, end, a0, a1)), None)
            start_hh = _min_to_hhmm(t)
            end_hh = _min_to_hhmm(end)
            est_cost = round(float(getattr(e, "cost_per_hour", None) or 0) * (use_dur / 60.0), 2)
            booking_status = getattr(hit, "status", None) if hit else None

            available = (hit is None) and not eq_blocked
            block_reason = None

            if available and is_external_request:
                slot_dt = datetime.combine(booking_date, datetime.strptime(start_hh, "%H:%M").time())
                hours_until = (slot_dt - now).total_seconds() / 3600.0
                if priority_hours > 0 and 0 <= hours_until <= priority_hours:
                    available = False
                    block_reason = f"owner_priority_window_{priority_hours}h"
                    booking_status = "owner_hold"
                elif external_cap_reached:
                    available = False
                    block_reason = f"external_share_cap_{max_ext_pct}%"
                    booking_status = "share_capped"

            slots.append({
                "slot_start": start_hh,
                "slot_end": end_hh,
                "duration_min": use_dur,
                "estimated_cost": est_cost,
                "available": available,
                "booking_status": booking_status,
                "block_reason": block_reason,
                "booking_number": getattr(hit, "booking_number", None) if hit else None,
                "requested_by": getattr(hit, "requested_by", None) if hit else None,
                "requesting_bu": getattr(hit, "requesting_bu", None) if hit else None,
            })
            t += step
        result.append({
            **_equipment_dict(e),
            "booking_date": str(booking_date),
            "selected_duration_min": use_dur,
            "request_type": request_type,
            "requesting_bu": requesting_bu,
            "rule": {
                "priority_window_hours": priority_hours,
                "max_external_share_pct": max_ext_pct,
                "auto_approve_owner": bool(getattr(rule, "auto_approve_owner", True)) if rule else True,
                "external_bookings_today": external_count,
                "max_external_slots": max_ext_slots,
                "total_slots": total_slots,
            },
            "slots": slots,
        })
    return result


class BookingIn(BaseModel):
    equipment_id: int
    requesting_bu: str
    booking_date: date
    slot_start: str
    duration_min: int = 60
    purpose: Optional[str] = None
    requested_by: Optional[str] = None
    asset_under_test: Optional[str] = None
    asset_under_test_name: Optional[str] = None
    fmms_wo_number: Optional[str] = None
    cost_amount: Optional[float] = None


@router.post("/bookings")
def create_booking(data: BookingIn, db: Session = Depends(get_db), user=Depends(get_current_user)):
    _ready(db)
    eq = db.query(TacoTestingEquipment).filter(TacoTestingEquipment.id == data.equipment_id).first()
    if not eq:
        raise HTTPException(404, "Equipment not found")
    if not eq.shareable:
        raise HTTPException(400, "Equipment is not shareable")

    allowed = _parse_durations(getattr(eq, "duration_options_min", None), getattr(eq, "default_duration_min", None) or 60)
    duration = int(data.duration_min or getattr(eq, "default_duration_min", None) or 60)
    if duration not in allowed:
        raise HTTPException(400, f"duration_min must be one of {allowed} for this equipment")

    start_m = _hhmm_to_min(data.slot_start)
    end_m = start_m + duration
    day0 = _hhmm_to_min(getattr(eq, "day_start", None) or "09:00")
    day1 = _hhmm_to_min(getattr(eq, "day_end", None) or "18:00")
    if start_m < day0 or end_m > day1:
        raise HTTPException(400, "Slot is outside equipment operating hours")

    existing = db.query(TacoTestingBooking).filter(
        TacoTestingBooking.equipment_id == data.equipment_id,
        TacoTestingBooking.booking_date == data.booking_date,
        TacoTestingBooking.status.in_(["requested", "confirmed", "in_use"]),
    ).all()
    for b in existing:
        if _ranges_overlap(start_m, end_m, _hhmm_to_min(b.slot_start), _hhmm_to_min(b.slot_end)):
            raise HTTPException(400, "Slot overlaps an existing booking")

    # Optional FMMS WO existence check (soft — allow if not found)
    wo_number = (data.fmms_wo_number or "").strip() or None

    est = float(getattr(eq, "cost_per_hour", None) or 0) * (duration / 60.0)
    cost = float(data.cost_amount) if data.cost_amount is not None else round(est, 2)

    priority = "owner_priority" if data.requesting_bu == eq.owning_bu else "normal"
    is_owner = data.requesting_bu == eq.owning_bu

    # Enforce TEST-09 rules for external requests
    if not is_owner:
        rule = db.query(TacoReservationRule).filter(
            TacoReservationRule.owning_bu == eq.owning_bu,
            TacoReservationRule.active.is_(True),
        ).first()
        if rule:
            day0 = _hhmm_to_min(getattr(eq, "day_start", None) or "09:00")
            day1 = _hhmm_to_min(getattr(eq, "day_end", None) or "18:00")
            step = min(30, duration) if duration >= 30 else duration
            total_slots = 0
            tcount = day0
            while tcount + duration <= day1:
                total_slots += 1
                tcount += step
            total_slots = max(total_slots, 1)
            day_bookings = db.query(TacoTestingBooking).filter(
                TacoTestingBooking.equipment_id == eq.id,
                TacoTestingBooking.booking_date == data.booking_date,
                TacoTestingBooking.status.in_(["requested", "confirmed", "in_use"]),
            ).all()
            external_count = sum(
                1 for b in day_bookings
                if b.requesting_bu and b.owning_bu and b.requesting_bu != b.owning_bu
            )
            max_ext = int((float(rule.max_external_share_pct or 100) / 100.0) * total_slots)
            if external_count >= max_ext:
                raise HTTPException(
                    400,
                    f"External share cap reached for {eq.owning_bu} "
                    f"({rule.max_external_share_pct}% → max {max_ext} external slots/day)",
                )
            slot_dt = datetime.combine(data.booking_date, datetime.strptime(_min_to_hhmm(start_m), "%H:%M").time())
            hours_until = (slot_dt - datetime.now()).total_seconds() / 3600.0
            if rule.priority_window_hours and 0 <= hours_until <= int(rule.priority_window_hours):
                raise HTTPException(
                    400,
                    f"Within owner priority window ({rule.priority_window_hours}h). "
                    f"Only {eq.owning_bu} can book this slot now.",
                )

    status = "confirmed" if (is_owner and True) else "requested"
    # Respect auto_approve_owner from rule (default True)
    if is_owner:
        rule = db.query(TacoReservationRule).filter(
            TacoReservationRule.owning_bu == eq.owning_bu,
            TacoReservationRule.active.is_(True),
        ).first()
        auto = True if not rule else bool(rule.auto_approve_owner)
        status = "confirmed" if auto else "requested"
    else:
        status = "requested"
    submitted = datetime.now()

    n = db.query(TacoTestingBooking).count() + 1
    row = TacoTestingBooking(
        booking_number=f"BK-{date.today().year}-{n:03d}",
        equipment_id=eq.id,
        equipment_code=eq.equipment_code,
        equipment_name=eq.name,
        owning_bu=eq.owning_bu,
        requesting_bu=data.requesting_bu,
        requested_by=data.requested_by or getattr(user, "username", None) or "user",
        booking_date=data.booking_date,
        slot_start=_min_to_hhmm(start_m),
        slot_end=_min_to_hhmm(end_m),
        duration_min=duration,
        asset_under_test=(data.asset_under_test or "").strip() or None,
        asset_under_test_name=(data.asset_under_test_name or "").strip() or None,
        fmms_wo_number=wo_number,
        cost_amount=cost,
        priority=priority,
        status=status,
        purpose=data.purpose,
        submitted_at=submitted,
    )
    db.add(row)
    if status == "confirmed" and eq.status == "available":
        eq.status = "booked"
    db.commit()
    db.refresh(row)
    return _booking_dict(row)


class BookingDecisionIn(BaseModel):
    action: str  # approve | reject
    decision_reason: Optional[str] = None


@router.patch("/bookings/{booking_id}/decision")
def decide_booking(
    booking_id: int,
    data: BookingDecisionIn,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Owning-BU / supervisor action board: approve or reject a requested slot."""
    _ready(db)
    row = db.query(TacoTestingBooking).filter(TacoTestingBooking.id == booking_id).first()
    if not row:
        raise HTTPException(404, "Booking not found")
    if row.status != "requested":
        raise HTTPException(400, f"Only requested bookings can be decided (current: {row.status})")

    action = (data.action or "").strip().lower()
    if action not in ("approve", "reject"):
        raise HTTPException(400, "action must be approve or reject")
    if action == "reject" and not (data.decision_reason or "").strip():
        raise HTTPException(400, "decision_reason is required when rejecting")

    if action == "approve":
        # Ensure no clash with another confirmed booking
        others = db.query(TacoTestingBooking).filter(
            TacoTestingBooking.equipment_id == row.equipment_id,
            TacoTestingBooking.booking_date == row.booking_date,
            TacoTestingBooking.id != row.id,
            TacoTestingBooking.status.in_(["confirmed", "in_use"]),
        ).all()
        for b in others:
            if _ranges_overlap(
                _hhmm_to_min(row.slot_start), _hhmm_to_min(row.slot_end),
                _hhmm_to_min(b.slot_start), _hhmm_to_min(b.slot_end),
            ):
                raise HTTPException(400, f"Conflicts with confirmed booking {b.booking_number}")
        row.status = "confirmed"
        row.decision_reason = (data.decision_reason or "").strip() or "Approved by owning BU / supervisor"
        eq = db.query(TacoTestingEquipment).filter(TacoTestingEquipment.id == row.equipment_id).first()
        if eq and eq.status == "available":
            eq.status = "booked"
    else:
        row.status = "cancelled"
        row.decision_reason = (data.decision_reason or "").strip()

    row.reviewed_by = getattr(user, "username", None) or "user"
    row.reviewed_at = datetime.now()
    db.commit()
    db.refresh(row)
    return _booking_dict(row)


# ── reservation rules ───────────────────────────────────────────────────────

@router.get("/reservation-rules")
def list_rules(db: Session = Depends(get_db), user=Depends(get_current_user)):
    _ready(db)
    rows = db.query(TacoReservationRule).order_by(TacoReservationRule.owning_bu).all()
    return [{
        "id": r.id, "rule_name": r.rule_name, "owning_bu": r.owning_bu,
        "priority_window_hours": r.priority_window_hours,
        "max_external_share_pct": float(r.max_external_share_pct or 0),
        "auto_approve_owner": bool(r.auto_approve_owner),
        "active": bool(r.active), "remarks": r.remarks,
    } for r in rows]


class ReservationRuleIn(BaseModel):
    rule_name: Optional[str] = None
    owning_bu: Optional[str] = None
    priority_window_hours: Optional[int] = None
    max_external_share_pct: Optional[float] = None
    auto_approve_owner: Optional[bool] = None
    active: Optional[bool] = None
    remarks: Optional[str] = None


@router.post("/reservation-rules")
def create_rule(data: ReservationRuleIn, db: Session = Depends(get_db), user=Depends(get_current_user)):
    _ready(db)
    if not data.owning_bu or not data.rule_name:
        raise HTTPException(400, "rule_name and owning_bu are required")
    row = TacoReservationRule(
        rule_name=data.rule_name.strip(),
        owning_bu=data.owning_bu.strip(),
        priority_window_hours=int(data.priority_window_hours or 24),
        max_external_share_pct=float(data.max_external_share_pct if data.max_external_share_pct is not None else 40),
        auto_approve_owner=True if data.auto_approve_owner is None else bool(data.auto_approve_owner),
        active=True if data.active is None else bool(data.active),
        remarks=data.remarks,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {
        "id": row.id, "rule_name": row.rule_name, "owning_bu": row.owning_bu,
        "priority_window_hours": row.priority_window_hours,
        "max_external_share_pct": float(row.max_external_share_pct or 0),
        "auto_approve_owner": bool(row.auto_approve_owner),
        "active": bool(row.active), "remarks": row.remarks,
    }


@router.patch("/reservation-rules/{rule_id}")
def update_rule(
    rule_id: int,
    data: ReservationRuleIn,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    _ready(db)
    row = db.query(TacoReservationRule).filter(TacoReservationRule.id == rule_id).first()
    if not row:
        raise HTTPException(404, "Rule not found")
    payload = data.model_dump(exclude_unset=True)
    if "priority_window_hours" in payload and payload["priority_window_hours"] is not None:
        payload["priority_window_hours"] = max(0, int(payload["priority_window_hours"]))
    if "max_external_share_pct" in payload and payload["max_external_share_pct"] is not None:
        pct = float(payload["max_external_share_pct"])
        if pct < 0 or pct > 100:
            raise HTTPException(400, "max_external_share_pct must be 0–100")
        payload["max_external_share_pct"] = pct
    for k, v in payload.items():
        setattr(row, k, v)
    db.commit()
    db.refresh(row)
    return {
        "id": row.id, "rule_name": row.rule_name, "owning_bu": row.owning_bu,
        "priority_window_hours": row.priority_window_hours,
        "max_external_share_pct": float(row.max_external_share_pct or 0),
        "auto_approve_owner": bool(row.auto_approve_owner),
        "active": bool(row.active), "remarks": row.remarks,
    }


# ── testing KPIs / savings ──────────────────────────────────────────────────

@router.get("/testing-kpis")
def testing_kpis(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """TEST-12 / TEST-13 monthly testing KPI + savings analytics."""
    _ready(db)
    today = date.today()
    month_start = today.replace(day=1)
    bookings = db.query(TacoTestingBooking).filter(TacoTestingBooking.booking_date >= month_start).all()
    completed = [b for b in bookings if b.status == "completed"]
    cross = [b for b in bookings if b.owning_bu != b.requesting_bu]
    savings_per_share = 8000
    savings = len(cross) * savings_per_share

    by_bu = {}
    for b in bookings:
        bucket = by_bu.setdefault(b.requesting_bu, {"business_unit": b.requesting_bu, "requests": 0, "cross_bu": 0})
        bucket["requests"] += 1
        if b.owning_bu != b.requesting_bu:
            bucket["cross_bu"] += 1

    equipment = db.query(TacoTestingEquipment).all()
    overall_util = round(sum(float(e.utilization_pct or 0) for e in equipment) / max(len(equipment), 1), 1)

    return {
        "month": month_start.strftime("%Y-%m"),
        "total_requests": len(bookings),
        "completed": len(completed),
        "cross_bu_shares": len(cross),
        "estimated_savings_inr": savings,
        "overall_utilization_pct": overall_util,
        "by_bu": list(by_bu.values()),
    }
