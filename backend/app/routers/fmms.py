"""FMMS Router — Facility Maintenance Management System.

Works independently and integrates with PMS via shared DB connection.
Each module has its own CRUD endpoints under /api/fmms/.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from sqlalchemy.orm import Session
from sqlalchemy import inspect as sa_inspect, text
from pydantic import BaseModel
from typing import Optional, Any
from datetime import date, datetime, timedelta
from pathlib import Path
import uuid

from ..models import get_db, engine, Machine
from ..upload_limits import MAX_IMAGE_BYTES, save_upload_limited
from ..models_fmms import (
    FmmsAsset, FmmsAssetHistory, FmmsAssetDocument,
    FmmsWorkOrder, FmmsPicAssignment, FmmsPicTechnician, FmmsPmcPlan,
    FmmsCompliance, FmmsAssetMonitor, FmmsSparePart, FmmsIncident,
    ASSET_HIERARCHY_LEVELS, ASSET_CLASSIFICATIONS,
)

PMC_MAX_MODIFICATIONS = 3
from ..auth import get_current_user, require_role

router = APIRouter(prefix="/api/fmms", tags=["fmms"])

FMMS_ASSET_UPLOAD_DIR = Path(__file__).parent.parent.parent / "static" / "fmms_assets"
FMMS_ASSET_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

MACHINE_TYPES = ["CNC", "VMC", "Lathe", "Grinding", "Drilling", "Milling", "Inspection", "Servo Press", "Servo Linear Motor", "PLC", "SPM", "Other"]

MEASURING_INSTRUMENTS = [
    "Screw Gauge",
    "Vernier Caliper",
    "Slip Gauge",
    "Plug Gauge",
    "Micrometer",
    "Dial Gauge",
    "Height Gauge",
    "Bore Gauge",
    "Feeler Gauge",
    "Thread Gauge",
    "Other Measuring Instrument",
]

QUALITY_INSTRUMENTS = [
    "Profile Projector",
    "Optical Microscope",
    "Tool Maker Microscope",
    "Vision Measuring System",
    "CMM (Coordinate Measuring Machine)",
    "Surface Roughness Tester",
    "Hardness Tester",
    "Optical Comparator",
    "Visual Inspection Station",
    "Other QA Instrument",
]

ASSET_SOURCES = ("machine", "measuring_instrument", "quality_instrument", "other")


def _ensure_fmms_tables():
    from ..models import Base
    insp = sa_inspect(engine)
    all_tables = [
        "fmms_assets", "fmms_asset_history", "fmms_asset_documents",
        "fmms_work_orders", "fmms_pic_assignments", "fmms_pic_technicians", "fmms_pmc_plans",
        "fmms_compliance", "fmms_asset_monitoring", "fmms_spare_parts", "fmms_incidents",
    ]
    missing = [t for t in all_tables if not insp.has_table(t)]
    if missing:
        Base.metadata.create_all(bind=engine, tables=[
            FmmsAsset.__table__, FmmsAssetHistory.__table__, FmmsAssetDocument.__table__,
            FmmsWorkOrder.__table__, FmmsPicAssignment.__table__,
            FmmsPicTechnician.__table__, FmmsPmcPlan.__table__,
            FmmsCompliance.__table__, FmmsAssetMonitor.__table__,
            FmmsSparePart.__table__, FmmsIncident.__table__,
        ])
        print(f"[FMMS] Created tables: {missing}")
    _ensure_asset_columns(insp)


def _ensure_asset_columns(insp):
    """Add hierarchy/history columns to existing fmms_assets deployments."""
    if not insp.has_table("fmms_assets"):
        return
    existing = {c["name"] for c in insp.get_columns("fmms_assets")}
    alters = []
    if "parent_id" not in existing:
        alters.append("ADD COLUMN parent_id INT NULL")
    if "hierarchy_level" not in existing:
        alters.append("ADD COLUMN hierarchy_level VARCHAR(30) DEFAULT 'equipment'")
    if "hierarchy_path" not in existing:
        alters.append("ADD COLUMN hierarchy_path VARCHAR(500) NULL")
    if "classification" not in existing:
        alters.append("ADD COLUMN classification VARCHAR(20) DEFAULT 'non_critical'")
    if "installation_date" not in existing:
        alters.append("ADD COLUMN installation_date DATE NULL")
    if "capital_investment" not in existing:
        alters.append("ADD COLUMN capital_investment FLOAT DEFAULT 0")
    if "revenue_investment" not in existing:
        alters.append("ADD COLUMN revenue_investment FLOAT DEFAULT 0")
    if "machine_id" not in existing:
        alters.append("ADD COLUMN machine_id INT NULL")
    if "machine_type" not in existing:
        alters.append("ADD COLUMN machine_type VARCHAR(50) NULL")
    if "building" not in existing:
        alters.append("ADD COLUMN building VARCHAR(200) NULL")
    if "facility_lab" not in existing:
        alters.append("ADD COLUMN facility_lab VARCHAR(200) NULL")
    if "equipment_name" not in existing:
        alters.append("ADD COLUMN equipment_name VARCHAR(200) NULL")
    if "sub_assembly" not in existing:
        alters.append("ADD COLUMN sub_assembly VARCHAR(200) NULL")
    if "image_url" not in existing:
        alters.append("ADD COLUMN image_url VARCHAR(500) NULL")
    if "qr_code" not in existing:
        alters.append("ADD COLUMN qr_code VARCHAR(200) NULL")
    if "schedule_type" not in existing:
        alters.append("ADD COLUMN schedule_type VARCHAR(30) DEFAULT 'calibration'")
    if "last_service_date" not in existing:
        alters.append("ADD COLUMN last_service_date DATE NULL")
    if "next_service_date" not in existing:
        alters.append("ADD COLUMN next_service_date DATE NULL")
    if "alert_before_days" not in existing:
        alters.append("ADD COLUMN alert_before_days INT DEFAULT 7")
    if "business_unit" not in existing:
        alters.append("ADD COLUMN business_unit VARCHAR(100) NULL")
    if alters:
        with engine.begin() as conn:
            for stmt in alters:
                try:
                    conn.execute(text(f"ALTER TABLE fmms_assets {stmt}"))
                except Exception as exc:
                    print(f"[FMMS] column migrate skipped: {exc}")
        print(f"[FMMS] fmms_assets columns migrated ({len(alters)} added)")


_ensure_fmms_tables()

_LEVEL_PREFIX = {
    "location": "LOC",
    "building": "BLD",
    "facility": "FAC",
    "equipment": "EQ",
    "sub_assembly": "SUB",
}
_CHILD_LEVEL = {
    None: "location",
    "location": "building",
    "building": "facility",
    "facility": "equipment",
    "equipment": "sub_assembly",
}


def _next_flat_asset_code(db: Session) -> str:
    """Global sequential asset ID for equipment registration (AST-000001)."""
    prefix = "AST"
    rows = db.query(FmmsAsset.asset_code).filter(FmmsAsset.asset_code.like(f"{prefix}-%")).all()
    max_n = 0
    for (code,) in rows:
        try:
            max_n = max(max_n, int(str(code).rsplit("-", 1)[-1]))
        except ValueError:
            continue
    return f"{prefix}-{max_n + 1:06d}"


def _qr_payload(asset_code: str, asset_id: int) -> str:
    return f"FMMS:{asset_code}:{asset_id}"


def _text_hierarchy_path(
    location: str | None,
    building: str | None,
    facility_lab: str | None,
    equipment_name: str | None,
    sub_assembly: str | None,
    asset_code: str,
) -> str:
    parts = [p.strip() for p in [location, building, facility_lab, equipment_name, sub_assembly] if p and str(p).strip()]
    return " / ".join(parts) if parts else asset_code


def _find_or_create_hierarchy_node(
    db: Session,
    parent_id: int | None,
    level: str,
    name: str,
    classification: str = "non_critical",
) -> int:
    name = name.strip()
    q = db.query(FmmsAsset).filter(FmmsAsset.hierarchy_level == level, FmmsAsset.name == name)
    if parent_id:
        q = q.filter(FmmsAsset.parent_id == parent_id)
    else:
        q = q.filter(FmmsAsset.parent_id.is_(None))
    existing = q.first()
    if existing:
        return existing.id
    parent = db.query(FmmsAsset).filter(FmmsAsset.id == parent_id).first() if parent_id else None
    code = _next_asset_code(db, parent, level)
    node = FmmsAsset(
        name=name,
        asset_code=code,
        parent_id=parent_id,
        hierarchy_level=level,
        classification=classification,
        status="active",
    )
    db.add(node)
    db.flush()
    node.hierarchy_path = _build_hierarchy_path(db, node)
    return node.id


def _resolve_flat_asset_parent(
    db: Session,
    location: str | None,
    building: str | None,
    facility_lab: str | None,
    equipment_name: str | None,
    sub_assembly: str | None,
    classification: str,
) -> tuple[int | None, str, str]:
    """Return (parent_id, hierarchy_level, display_name) for flat equipment form."""
    parent_id: int | None = None
    if location and location.strip():
        parent_id = _find_or_create_hierarchy_node(db, None, "location", location, classification)
    if building and building.strip():
        parent_id = _find_or_create_hierarchy_node(db, parent_id, "building", building, classification)
    if facility_lab and facility_lab.strip():
        parent_id = _find_or_create_hierarchy_node(db, parent_id, "facility", facility_lab, classification)

    if sub_assembly and sub_assembly.strip():
        if equipment_name and equipment_name.strip():
            parent_id = _find_or_create_hierarchy_node(db, parent_id, "equipment", equipment_name, classification)
        return parent_id, "sub_assembly", sub_assembly.strip()
    if equipment_name and equipment_name.strip():
        return parent_id, "equipment", equipment_name.strip()
    return parent_id, "equipment", ""


def _next_asset_code(db: Session, parent: FmmsAsset | None, level: str) -> str:
    prefix = _LEVEL_PREFIX.get(level, "AST")
    if parent:
        base = parent.asset_code
        siblings = db.query(FmmsAsset).filter(
            FmmsAsset.parent_id == parent.id,
            FmmsAsset.hierarchy_level == level,
        ).count()
        return f"{base}-{prefix}-{siblings + 1:03d}"
    siblings = db.query(FmmsAsset).filter(
        FmmsAsset.parent_id.is_(None),
        FmmsAsset.hierarchy_level == level,
    ).count()
    return f"{prefix}-{siblings + 1:03d}"


def _build_hierarchy_path(db: Session, asset: FmmsAsset) -> str:
    parts = [asset.asset_code]
    cur = asset
    seen = {asset.id}
    while cur.parent_id:
        parent = db.query(FmmsAsset).filter(FmmsAsset.id == cur.parent_id).first()
        if not parent or parent.id in seen:
            break
        parts.insert(0, parent.asset_code)
        seen.add(parent.id)
        cur = parent
    return " / ".join(parts)


def _service_alert_info(a: FmmsAsset, today: date | None = None) -> dict[str, Any] | None:
    """Return alert payload when within threshold of next service / overdue."""
    next_dt = getattr(a, "next_service_date", None)
    if not next_dt:
        return None
    today = today or date.today()
    days_before = int(getattr(a, "alert_before_days", None) or 7)
    if days_before < 0:
        days_before = 0
    days_until = (next_dt - today).days
    alert_start = next_dt - timedelta(days=days_before)
    if today < alert_start:
        return None
    schedule = (getattr(a, "schedule_type", None) or "calibration").lower()
    label = "Calibration" if schedule == "calibration" else "PM"
    if days_until < 0:
        severity = "alert"
        status = "overdue"
        title = f"{label} overdue — {a.asset_code}"
        body = f"{a.name}: {label} was due on {next_dt} ({abs(days_until)} day(s) overdue)"
    elif days_until == 0:
        severity = "alert"
        status = "due_today"
        title = f"{label} due today — {a.asset_code}"
        body = f"{a.name}: {label} is due today ({next_dt})"
    else:
        severity = "warning"
        status = "due_soon"
        title = f"{label} due in {days_until} day(s) — {a.asset_code}"
        body = f"{a.name}: {label} due on {next_dt} (alert set {days_before} day(s) before)"
    return {
        "asset_id": a.id,
        "asset_code": a.asset_code,
        "name": a.name,
        "schedule_type": schedule,
        "last_service_date": str(getattr(a, "last_service_date", None) or "") or None,
        "next_service_date": str(next_dt),
        "alert_before_days": days_before,
        "days_until": days_until,
        "status": status,
        "severity": severity,
        "title": title,
        "body": body,
        "path": "/fmms/assets",
    }


def _asset_dict(a: FmmsAsset) -> dict[str, Any]:
    alert = _service_alert_info(a)
    return {
        "id": a.id,
        "asset_code": a.asset_code,
        "name": a.name,
        "parent_id": a.parent_id,
        "hierarchy_level": a.hierarchy_level,
        "hierarchy_path": a.hierarchy_path,
        "classification": getattr(a, "classification", None) or "non_critical",
        "category": a.category,
        "machine_id": getattr(a, "machine_id", None),
        "machine_type": getattr(a, "machine_type", None),
        "location": a.location,
        "building": getattr(a, "building", None),
        "facility_lab": getattr(a, "facility_lab", None),
        "equipment_name": getattr(a, "equipment_name", None),
        "sub_assembly": getattr(a, "sub_assembly", None),
        "department": a.department,
        "business_unit": getattr(a, "business_unit", None) or a.department,
        "manufacturer": a.manufacturer,
        "model_number": a.model_number,
        "serial_number": a.serial_number,
        "image_url": getattr(a, "image_url", None),
        "qr_code": getattr(a, "qr_code", None),
        "installation_date": str(a.installation_date) if getattr(a, "installation_date", None) else None,
        "purchase_date": str(a.purchase_date) if a.purchase_date else None,
        "warranty_expiry": str(a.warranty_expiry) if a.warranty_expiry else None,
        "schedule_type": getattr(a, "schedule_type", None) or "calibration",
        "last_service_date": str(a.last_service_date) if getattr(a, "last_service_date", None) else None,
        "next_service_date": str(a.next_service_date) if getattr(a, "next_service_date", None) else None,
        "alert_before_days": int(getattr(a, "alert_before_days", None) or 7),
        "service_alert": alert,
        "capital_investment": float(getattr(a, "capital_investment", 0) or 0),
        "revenue_investment": float(getattr(a, "revenue_investment", 0) or 0),
        "status": a.status,
        "criticality": a.criticality,
        "notes": a.notes,
        "created_at": str(a.created_at) if a.created_at else None,
        "updated_at": str(a.updated_at) if getattr(a, "updated_at", None) else None,
    }


def _history_dict(h: FmmsAssetHistory) -> dict[str, Any]:
    return {
        "id": h.id,
        "asset_id": h.asset_id,
        "event_type": h.event_type,
        "title": h.title,
        "description": h.description,
        "event_date": str(h.event_date) if h.event_date else None,
        "cost": float(h.cost or 0),
        "cost_category": h.cost_category,
        "reference_number": h.reference_number,
        "performed_by": h.performed_by,
        "created_by": h.created_by,
        "created_at": str(h.created_at) if h.created_at else None,
    }


def _document_dict(d: FmmsAssetDocument) -> dict[str, Any]:
    return {
        "id": d.id,
        "asset_id": d.asset_id,
        "doc_type": d.doc_type,
        "doc_number": d.doc_number,
        "title": d.title,
        "doc_date": str(d.doc_date) if d.doc_date else None,
        "amount": float(d.amount or 0),
        "vendor": d.vendor,
        "file_url": d.file_url,
        "remarks": d.remarks,
        "created_at": str(d.created_at) if d.created_at else None,
    }


def _build_tree_node(db: Session, asset: FmmsAsset) -> dict[str, Any]:
    children = db.query(FmmsAsset).filter(FmmsAsset.parent_id == asset.id).order_by(FmmsAsset.name).all()
    node = _asset_dict(asset)
    node["children"] = [_build_tree_node(db, c) for c in children]
    return node


# ═══════════════════════════════════════════════════════════════════════════════
# Asset Management (FR-01 … FR-04)
# ═══════════════════════════════════════════════════════════════════════════════
class AssetCreate(BaseModel):
    name: Optional[str] = None
    asset_code: Optional[str] = None
    parent_id: Optional[int] = None
    hierarchy_level: Optional[str] = "equipment"
    classification: Optional[str] = "non_critical"
    category: Optional[str] = None
    asset_source: Optional[str] = "equipment"  # machine | other | hierarchy
    machine_id: Optional[int] = None
    machine_type: Optional[str] = None
    location: Optional[str] = None
    building: Optional[str] = None
    facility_lab: Optional[str] = None
    equipment_name: Optional[str] = None
    sub_assembly: Optional[str] = None
    department: Optional[str] = None
    manufacturer: Optional[str] = None
    model_number: Optional[str] = None
    serial_number: Optional[str] = None
    installation_date: Optional[date] = None
    purchase_date: Optional[date] = None
    warranty_expiry: Optional[date] = None
    schedule_type: Optional[str] = "calibration"  # calibration | pm
    last_service_date: Optional[date] = None
    next_service_date: Optional[date] = None
    alert_before_days: Optional[int] = 7
    capital_investment: Optional[float] = 0
    revenue_investment: Optional[float] = 0
    status: Optional[str] = "active"
    criticality: Optional[str] = "medium"
    notes: Optional[str] = None
    image_url: Optional[str] = None
    auto_code: Optional[bool] = True
    flat_form: Optional[bool] = True


class AssetHistoryCreate(BaseModel):
    event_type: str
    title: str
    description: Optional[str] = None
    event_date: Optional[date] = None
    cost: Optional[float] = 0
    cost_category: Optional[str] = None
    reference_number: Optional[str] = None
    performed_by: Optional[str] = None


class AssetDocumentCreate(BaseModel):
    doc_type: str
    doc_number: Optional[str] = None
    title: Optional[str] = None
    doc_date: Optional[date] = None
    amount: Optional[float] = 0
    vendor: Optional[str] = None
    file_url: Optional[str] = None
    remarks: Optional[str] = None


@router.get("/assets/meta")
def asset_meta(user=Depends(get_current_user)):
    return {
        "hierarchyLevels": list(ASSET_HIERARCHY_LEVELS),
        "classifications": list(ASSET_CLASSIFICATIONS),
        "historyEventTypes": [
            "purchase", "installation", "breakdown", "amc", "calibration",
            "inhouse_maintenance", "investment", "manpower_cost",
        ],
        "documentTypes": [
            "sor", "quotation", "purchase_order", "invoice", "inspection_report", "other",
        ],
        "levelLabels": {
            "location": "Location",
            "building": "Building",
            "facility": "Facility / Lab",
            "equipment": "Equipment",
            "sub_assembly": "Sub-assembly",
        },
        "machineTypes": MACHINE_TYPES,
        "measuringInstruments": MEASURING_INSTRUMENTS,
        "qualityInstruments": QUALITY_INSTRUMENTS,
        "assetSources": [
            {"id": "machine", "label": "Machine (Machine Configuration)"},
            {"id": "measuring_instrument", "label": "Measuring Instruments"},
            {"id": "quality_instrument", "label": "Quality / QA Instruments"},
            {"id": "other", "label": "Other Equipment"},
        ],
        "assetStatuses": ["active", "inactive", "under_maintenance", "decommissioned"],
        "scheduleTypes": [
            {"id": "calibration", "label": "Calibration"},
            {"id": "pm", "label": "Preventive Maintenance (PM)"},
        ],
    }


@router.get("/assets/next-code")
def next_asset_code(db: Session = Depends(get_db), user=Depends(get_current_user)):
    return {"asset_code": _next_flat_asset_code(db)}


@router.get("/assets/machines")
def list_mappable_machines(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Machines from Machine Configuration — excludes those already mapped to an FMMS asset."""
    mapped_ids = {
        row[0]
        for row in db.query(FmmsAsset.machine_id).filter(FmmsAsset.machine_id.isnot(None)).all()
        if row[0]
    }
    machines = db.query(Machine).order_by(Machine.station_id, Machine.name).all()
    out = []
    for m in machines:
        if m.id in mapped_ids:
            continue
        out.append({
            "id": m.id,
            "name": m.name,
            "machine_type": m.machine_type,
            "make": m.make,
            "model_no": m.model_no,
            "location": m.location,
            "image_url": m.image_url,
            "station_id": m.station_id,
        })
    return out


@router.get("/assets/tree")
def asset_tree(db: Session = Depends(get_db), user=Depends(get_current_user)):
    roots = db.query(FmmsAsset).filter(FmmsAsset.parent_id.is_(None)).order_by(FmmsAsset.name).all()
    return [_build_tree_node(db, r) for r in roots]


@router.get("/assets")
def list_assets(
    parent_id: Optional[int] = None,
    hierarchy_level: Optional[str] = None,
    classification: Optional[str] = None,
    business_unit: Optional[str] = None,
    search: Optional[str] = None,
    equipment_only: bool = False,
    page: Optional[int] = Query(None, ge=1),
    page_size: Optional[int] = Query(None, ge=1, le=1000),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    List assets. For Asset Management UI use equipment_only=true&page=&page_size=
    so hierarchy scaffolding (LOC/BLD/FAC) is excluded and results are paginated.
    business_unit filters TACO BU (TEST-01 / TEST-02).
    """
    q = db.query(FmmsAsset)
    if parent_id is not None:
        q = q.filter(FmmsAsset.parent_id == parent_id)
    if hierarchy_level:
        q = q.filter(FmmsAsset.hierarchy_level == hierarchy_level)
    if classification:
        q = q.filter(FmmsAsset.classification == classification)
    if business_unit:
        like_bu = f"%{business_unit}%"
        q = q.filter(
            (FmmsAsset.business_unit.ilike(like_bu))
            | (FmmsAsset.department.ilike(like_bu))
            | (FmmsAsset.location.ilike(like_bu))
        )
    if equipment_only:
        # Registered equipment only — hide Location / Building / Facility scaffolding
        q = q.filter(
            FmmsAsset.hierarchy_level.in_(("equipment", "sub_assembly")),
            (
                FmmsAsset.asset_code.like("AST-%")
                | FmmsAsset.machine_id.isnot(None)
                | FmmsAsset.machine_type.isnot(None)
                | FmmsAsset.next_service_date.isnot(None)
            ),
        )
    if search:
        like = f"%{search}%"
        q = q.filter(
            (FmmsAsset.name.ilike(like))
            | (FmmsAsset.asset_code.ilike(like))
            | (FmmsAsset.serial_number.ilike(like))
            | (FmmsAsset.location.ilike(like))
            | (FmmsAsset.building.ilike(like))
            | (FmmsAsset.facility_lab.ilike(like))
            | (FmmsAsset.equipment_name.ilike(like))
            | (FmmsAsset.machine_type.ilike(like))
            | (FmmsAsset.department.ilike(like))
            | (FmmsAsset.business_unit.ilike(like))
        )
    q = q.order_by(FmmsAsset.asset_code.desc(), FmmsAsset.name.asc())

    # Paginated response for Asset Management (large fleets)
    if page is not None or page_size is not None or equipment_only:
        pg = page or 1
        ps = page_size or 25
        total = q.count()
        rows = q.offset((pg - 1) * ps).limit(ps).all()
        return {
            "items": [_asset_dict(a) for a in rows],
            "total": total,
            "page": pg,
            "page_size": ps,
            "pages": max(1, (total + ps - 1) // ps) if total else 1,
        }

    return [_asset_dict(a) for a in q.all()]


def _validate_schedule(data: AssetCreate, require: bool = True) -> tuple[str, date | None, date | None, int]:
    schedule = (data.schedule_type or "calibration").strip().lower()
    if schedule not in ("calibration", "pm"):
        raise HTTPException(400, "schedule_type must be calibration or pm")
    last_dt = data.last_service_date
    next_dt = data.next_service_date
    days = data.alert_before_days if data.alert_before_days is not None else 7
    try:
        days = int(days)
    except (TypeError, ValueError):
        raise HTTPException(400, "alert_before_days must be a number")
    if days < 0 or days > 3650:
        raise HTTPException(400, "alert_before_days must be between 0 and 3650")
    if require:
        if not last_dt:
            raise HTTPException(400, "Last Calibration / Last PM date is required")
        if not next_dt:
            raise HTTPException(400, "Next Calibration / Next PM date is required")
    if last_dt and next_dt and next_dt < last_dt:
        raise HTTPException(400, "Next service date must be on or after last service date")
    return schedule, last_dt, next_dt, days


@router.get("/assets/alerts")
def list_asset_service_alerts(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Calibration / PM alerts that have reached the configured threshold."""
    assets = db.query(FmmsAsset).filter(FmmsAsset.next_service_date.isnot(None)).all()
    today = date.today()
    alerts = []
    for a in assets:
        info = _service_alert_info(a, today)
        if info:
            alerts.append(info)
    alerts.sort(key=lambda x: (0 if x["status"] == "overdue" else 1 if x["status"] == "due_today" else 2, x["days_until"]))
    return {
        "count": len(alerts),
        "overdue": len([a for a in alerts if a["status"] == "overdue"]),
        "due_today": len([a for a in alerts if a["status"] == "due_today"]),
        "due_soon": len([a for a in alerts if a["status"] == "due_soon"]),
        "items": alerts,
    }


@router.post("/assets")
def create_asset(data: AssetCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    classification = data.classification or "non_critical"
    if classification not in ASSET_CLASSIFICATIONS:
        raise HTTPException(400, f"Invalid classification. Use: {', '.join(ASSET_CLASSIFICATIONS)}")

    use_flat = bool(data.flat_form) and data.asset_source != "hierarchy"
    machine = None
    if data.machine_id:
        machine = db.query(Machine).filter(Machine.id == data.machine_id).first()
        if not machine:
            raise HTTPException(404, "Machine not found")
        dup = db.query(FmmsAsset).filter(FmmsAsset.machine_id == data.machine_id).first()
        if dup:
            raise HTTPException(400, f"Machine already mapped to asset {dup.asset_code}")

    if use_flat:
        source = (data.asset_source or "other").strip()
        if source not in ASSET_SOURCES:
            source = "other"
        # Instruments use instrument type as machine_type; machines require type from config/form
        if source == "machine" and not data.machine_type and not machine:
            raise HTTPException(400, "Machine Type is required")
        if source in ("measuring_instrument", "quality_instrument") and not data.machine_type and not data.name:
            raise HTTPException(400, "Select an instrument type")
        if source == "other" and not data.machine_type and not machine and not data.name and not data.equipment_name:
            raise HTTPException(400, "Equipment name or type is required")

        schedule, last_dt, next_dt, alert_days = _validate_schedule(data, require=True)

        parent_id, level, leaf_name = _resolve_flat_asset_parent(
            db,
            data.location,
            data.building,
            data.facility_lab,
            data.equipment_name,
            data.sub_assembly,
            classification,
        )
        asset_name = (data.name or leaf_name or "").strip()
        if not asset_name and machine:
            asset_name = machine.name
        if not asset_name and data.machine_type:
            asset_name = data.machine_type
        if not asset_name:
            raise HTTPException(400, "Asset name is required (or select a machine / instrument / fill Equipment)")

        code = data.asset_code if data.asset_code and not data.auto_code else _next_flat_asset_code(db)
        if db.query(FmmsAsset).filter(FmmsAsset.asset_code == code).first():
            raise HTTPException(400, f"Asset code already exists: {code}")

        category = data.category or source
        asset = FmmsAsset(
            asset_code=code,
            name=asset_name,
            parent_id=parent_id,
            hierarchy_level=level,
            classification=classification,
            category=category,
            machine_id=data.machine_id if source == "machine" else None,
            machine_type=data.machine_type or (machine.machine_type if machine else None),
            location=data.location or (machine.location if machine else None),
            building=data.building,
            facility_lab=data.facility_lab,
            equipment_name=data.equipment_name or (machine.name if machine else None) or asset_name,
            sub_assembly=data.sub_assembly,
            department=data.department,
            manufacturer=data.manufacturer or (machine.make if machine else None),
            model_number=data.model_number or (machine.model_no if machine else None),
            serial_number=data.serial_number,
            installation_date=data.installation_date,
            purchase_date=data.purchase_date,
            warranty_expiry=data.warranty_expiry,
            schedule_type=schedule,
            last_service_date=last_dt,
            next_service_date=next_dt,
            alert_before_days=alert_days,
            capital_investment=data.capital_investment or 0,
            revenue_investment=data.revenue_investment or 0,
            status=data.status or "active",
            criticality=data.criticality or "medium",
            notes=data.notes,
            image_url=data.image_url or (machine.image_url if machine else None),
        )
        db.add(asset)
        db.flush()
        asset.hierarchy_path = _text_hierarchy_path(
            asset.location, asset.building, asset.facility_lab,
            asset.equipment_name, asset.sub_assembly, asset.asset_code,
        )
        asset.qr_code = _qr_payload(asset.asset_code, asset.id)
        db.commit()
        db.refresh(asset)
    else:
        level = data.hierarchy_level or "equipment"
        if level not in ASSET_HIERARCHY_LEVELS:
            raise HTTPException(400, f"Invalid hierarchy_level. Use: {', '.join(ASSET_HIERARCHY_LEVELS)}")

        parent = None
        if data.parent_id:
            parent = db.query(FmmsAsset).filter(FmmsAsset.id == data.parent_id).first()
            if not parent:
                raise HTTPException(404, "Parent asset not found")
            expected_child = _CHILD_LEVEL.get(parent.hierarchy_level)
            if expected_child and level != expected_child:
                raise HTTPException(400, f"Under {parent.hierarchy_level}, child must be {expected_child}")
        elif level != "location":
            raise HTTPException(400, "Root nodes must be hierarchy_level=location")

        if not data.name:
            raise HTTPException(400, "Name is required")

        code = data.asset_code
        if data.auto_code or not code:
            code = _next_asset_code(db, parent, level)
        if db.query(FmmsAsset).filter(FmmsAsset.asset_code == code).first():
            raise HTTPException(400, f"Asset code already exists: {code}")

        payload = data.dict(exclude={"auto_code", "flat_form", "asset_source"})
        payload["asset_code"] = code
        payload["hierarchy_level"] = level
        payload["parent_id"] = data.parent_id
        asset = FmmsAsset(**{k: v for k, v in payload.items() if k in {
            "name", "asset_code", "parent_id", "hierarchy_level", "classification", "category",
            "location", "building", "facility_lab", "equipment_name", "sub_assembly",
            "department", "manufacturer", "model_number", "serial_number",
            "installation_date", "purchase_date", "warranty_expiry",
            "schedule_type", "last_service_date", "next_service_date", "alert_before_days",
            "capital_investment", "revenue_investment", "status", "criticality", "notes",
            "machine_id", "machine_type", "image_url",
        }})
        db.add(asset)
        db.flush()
        asset.hierarchy_path = _build_hierarchy_path(db, asset)
        asset.qr_code = _qr_payload(asset.asset_code, asset.id)
        db.commit()
        db.refresh(asset)

    if data.installation_date:
        hist = FmmsAssetHistory(
            asset_id=asset.id,
            event_type="installation",
            title=f"Installed — {asset.name}",
            event_date=data.installation_date,
            created_by=getattr(user, "username", None),
        )
        db.add(hist)
        db.commit()
        db.refresh(asset)

    return _asset_dict(asset)


@router.post("/assets/{asset_id}/image")
async def upload_asset_image(
    asset_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    asset = db.query(FmmsAsset).filter(FmmsAsset.id == asset_id).first()
    if not asset:
        raise HTTPException(404, "Asset not found")
    ext = Path(file.filename or "").suffix.lower() or ".jpg"
    if ext not in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
        raise HTTPException(400, "Allowed formats: JPG, PNG, WebP, GIF")
    fname = f"asset_{asset_id}_{uuid.uuid4().hex[:8]}{ext}"
    fpath = FMMS_ASSET_UPLOAD_DIR / fname
    await save_upload_limited(file, fpath, MAX_IMAGE_BYTES)
    asset.image_url = f"/static/fmms_assets/{fname}"
    db.commit()
    return {"image_url": asset.image_url}


@router.get("/assets/history/summary")
def asset_history_summary(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """
    Asset Registry + latest lifecycle snapshot for the Asset History screen.
    Registered equipment only (AST / scheduled / mapped) — not LOC/BLD/FAC scaffolds.
    """
    assets = db.query(FmmsAsset).filter(
        FmmsAsset.hierarchy_level.in_(("equipment", "sub_assembly")),
        (
            FmmsAsset.asset_code.like("AST-%")
            | FmmsAsset.machine_id.isnot(None)
            | FmmsAsset.machine_type.isnot(None)
            | FmmsAsset.next_service_date.isnot(None)
        ),
    ).order_by(FmmsAsset.asset_code.desc(), FmmsAsset.name.asc()).all()
    if not assets:
        return []

    history_rows = db.query(FmmsAssetHistory).order_by(
        FmmsAssetHistory.asset_id.asc(),
        FmmsAssetHistory.event_date.desc(),
        FmmsAssetHistory.id.desc(),
    ).all()

    latest_by_asset: dict[int, FmmsAssetHistory] = {}
    history_count: dict[int, int] = {}
    for h in history_rows:
        history_count[h.asset_id] = history_count.get(h.asset_id, 0) + 1
        if h.asset_id not in latest_by_asset:
            latest_by_asset[h.asset_id] = h

    out: list[dict[str, Any]] = []
    for a in assets:
        last = latest_by_asset.get(a.id)
        hierarchy_id = (
            a.hierarchy_path
            or " / ".join(p for p in [
                getattr(a, "location", None),
                getattr(a, "building", None),
                getattr(a, "facility_lab", None),
                a.asset_code,
            ] if p)
            or a.asset_code
        )
        out.append({
            "asset_id": a.id,
            "asset_code": a.asset_code,
            "name": a.name,
            "hierarchy_asset_id": hierarchy_id,
            "classification": getattr(a, "classification", None) or "non_critical",
            "category": a.category,
            "status": a.status,
            "hierarchy_path": a.hierarchy_path,
            "location": a.location,
            "building": getattr(a, "building", None),
            "facility_lab": getattr(a, "facility_lab", None),
            "next_service_date": str(a.next_service_date) if getattr(a, "next_service_date", None) else None,
            "alert_before_days": int(getattr(a, "alert_before_days", None) or 5),
            "schedule_type": getattr(a, "schedule_type", None) or "calibration",
            "last_event_type": last.event_type if last else None,
            "last_event_date": str(last.event_date) if last and last.event_date else None,
            "last_title": last.title if last else None,
            "last_cost": float(last.cost or 0) if last else 0.0,
            "last_cost_category": last.cost_category if last else None,
            "last_reference": last.reference_number if last else None,
            "last_performed_by": last.performed_by if last else None,
            "history_count": history_count.get(a.id, 0),
        })
    return out


DEMO_LIFECYCLE_ROWS = [
    {
        "event_type": "purchase",
        "title": "Purchase Order / Invoice",
        "event_date": date(2024, 1, 15),
        "reference_number": "PO-MSIL-2024-88 (SOR Link)",
        "performed_by": None,
        "cost": 85_000_000,
        "cost_category": "capital",
        "description": "Demo lifecycle — capital purchase",
    },
    {
        "event_type": "installation",
        "title": "Installation & Comm.",
        "event_date": date(2024, 2, 10),
        "reference_number": None,
        "performed_by": "In-House Engg Team",
        "cost": 45_000,
        "cost_category": "manpower",
        "description": "Demo lifecycle — installation & commissioning",
    },
    {
        "event_type": "amc",
        "title": "AMC Service Entry",
        "event_date": date(2026, 5, 12),
        "reference_number": None,
        "performed_by": "Vendor: Siemens India",
        "cost": 120_000,
        "cost_category": "revenue",
        "description": "Demo lifecycle — AMC service",
    },
]


@router.post("/assets/history/seed-demo")
def seed_demo_lifecycle_history(
    all_assets: bool = True,
    asset_id: Optional[int] = None,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Insert sample Lifecycle Asset History rows (PO / Installation / AMC)
    for one asset or all registered equipment assets.
    Skips insert when the same event_type + event_date already exists for that asset.
    """
    q = db.query(FmmsAsset).filter(
        FmmsAsset.hierarchy_level.in_(("equipment", "sub_assembly")),
        (
            FmmsAsset.asset_code.like("AST-%")
            | FmmsAsset.machine_id.isnot(None)
            | FmmsAsset.machine_type.isnot(None)
            | FmmsAsset.next_service_date.isnot(None)
        ),
    )
    if asset_id is not None:
        q = q.filter(FmmsAsset.id == asset_id)
    elif not all_assets:
        first = q.order_by(FmmsAsset.id.asc()).first()
        assets = [first] if first else []
        q = None
    if q is not None:
        assets = q.order_by(FmmsAsset.id.asc()).all()

    created = 0
    touched_assets = 0
    for a in assets:
        if not a:
            continue
        added_for_asset = 0
        for row in DEMO_LIFECYCLE_ROWS:
            exists = db.query(FmmsAssetHistory).filter(
                FmmsAssetHistory.asset_id == a.id,
                FmmsAssetHistory.event_type == row["event_type"],
                FmmsAssetHistory.event_date == row["event_date"],
            ).first()
            if exists:
                continue
            db.add(FmmsAssetHistory(
                asset_id=a.id,
                event_type=row["event_type"],
                title=row["title"],
                description=row["description"],
                event_date=row["event_date"],
                cost=row["cost"],
                cost_category=row["cost_category"],
                reference_number=row["reference_number"],
                performed_by=row["performed_by"],
                created_by=getattr(user, "username", None) or "demo_seed",
            ))
            created += 1
            added_for_asset += 1
        if added_for_asset:
            touched_assets += 1
    db.commit()
    return {
        "ok": True,
        "assets_updated": touched_assets,
        "records_created": created,
        "message": f"Seeded {created} lifecycle record(s) across {touched_assets} asset(s).",
    }


@router.get("/assets/{asset_id}")
def get_asset(asset_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    asset = db.query(FmmsAsset).filter(FmmsAsset.id == asset_id).first()
    if not asset:
        raise HTTPException(404, "Asset not found")
    out = _asset_dict(asset)
    out["child_count"] = db.query(FmmsAsset).filter(FmmsAsset.parent_id == asset_id).count()
    return out


@router.patch("/assets/{asset_id}")
def update_asset(asset_id: int, data: AssetCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    asset = db.query(FmmsAsset).filter(FmmsAsset.id == asset_id).first()
    if not asset:
        raise HTTPException(404, "Asset not found")
    # Validate schedule when any schedule field is being set (required on edit for equipment assets)
    if data.flat_form is not False:
        schedule, last_dt, next_dt, alert_days = _validate_schedule(data, require=True)
        data.schedule_type = schedule
        data.last_service_date = last_dt
        data.next_service_date = next_dt
        data.alert_before_days = alert_days
    updates = data.dict(exclude_unset=True, exclude={
        "auto_code", "asset_code", "parent_id", "hierarchy_level", "flat_form", "asset_source",
    })
    if data.classification and data.classification not in ASSET_CLASSIFICATIONS:
        raise HTTPException(400, "Invalid classification")
    for k, v in updates.items():
        if hasattr(asset, k):
            setattr(asset, k, v)
    # Prefer human-readable place path when flat fields are present
    if any(getattr(asset, f, None) for f in ("location", "building", "facility_lab", "equipment_name", "sub_assembly")):
        asset.hierarchy_path = _text_hierarchy_path(
            asset.location, asset.building, asset.facility_lab,
            asset.equipment_name, asset.sub_assembly, asset.asset_code,
        )
    else:
        asset.hierarchy_path = _build_hierarchy_path(db, asset)
    if not getattr(asset, "qr_code", None):
        asset.qr_code = _qr_payload(asset.asset_code, asset.id)
    db.commit()
    db.refresh(asset)
    return _asset_dict(asset)


@router.delete("/assets/{asset_id}")
def delete_asset(asset_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    asset = db.query(FmmsAsset).filter(FmmsAsset.id == asset_id).first()
    if not asset:
        raise HTTPException(404, "Asset not found")
    child_count = db.query(FmmsAsset).filter(FmmsAsset.parent_id == asset_id).count()
    if child_count:
        raise HTTPException(400, "Cannot delete asset with child nodes in hierarchy. Remove child assets first.")
    db.query(FmmsAssetHistory).filter(FmmsAssetHistory.asset_id == asset_id).delete()
    db.query(FmmsAssetDocument).filter(FmmsAssetDocument.asset_id == asset_id).delete()
    db.delete(asset)
    db.commit()
    return {"ok": True}


@router.get("/assets/{asset_id}/history")
def list_asset_history(asset_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    rows = db.query(FmmsAssetHistory).filter(FmmsAssetHistory.asset_id == asset_id).order_by(
        FmmsAssetHistory.event_date.desc(), FmmsAssetHistory.id.desc()
    ).all()
    return [_history_dict(h) for h in rows]


@router.post("/assets/{asset_id}/history")
def create_asset_history(
    asset_id: int,
    data: AssetHistoryCreate,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    if not db.query(FmmsAsset).filter(FmmsAsset.id == asset_id).first():
        raise HTTPException(404, "Asset not found")
    hist = FmmsAssetHistory(
        asset_id=asset_id,
        created_by=getattr(user, "username", None),
        **data.dict(),
    )
    db.add(hist)
    db.commit()
    db.refresh(hist)
    return _history_dict(hist)


@router.get("/assets/{asset_id}/documents")
def list_asset_documents(asset_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    rows = db.query(FmmsAssetDocument).filter(FmmsAssetDocument.asset_id == asset_id).order_by(
        FmmsAssetDocument.doc_date.desc(), FmmsAssetDocument.id.desc()
    ).all()
    return [_document_dict(d) for d in rows]


@router.post("/assets/{asset_id}/documents")
def create_asset_document(
    asset_id: int,
    data: AssetDocumentCreate,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    if not db.query(FmmsAsset).filter(FmmsAsset.id == asset_id).first():
        raise HTTPException(404, "Asset not found")
    doc = FmmsAssetDocument(asset_id=asset_id, **data.dict())
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return _document_dict(doc)


# ═══════════════════════════════════════════════════════════════════════════════
# Work Order Management
# ═══════════════════════════════════════════════════════════════════════════════
class WorkOrderCreate(BaseModel):
    title: str
    asset_id: Optional[int] = None
    description: Optional[str] = None
    priority: Optional[str] = "medium"
    wo_type: Optional[str] = "corrective"
    status: Optional[str] = "open"
    requested_by: Optional[str] = None
    assigned_to: Optional[str] = None
    due_date: Optional[date] = None
    estimated_hours: Optional[float] = None


@router.get("/work-orders")
def list_work_orders(db: Session = Depends(get_db), user=Depends(get_current_user)):
    return [_wo_dict(w) for w in db.query(FmmsWorkOrder).order_by(FmmsWorkOrder.id.desc()).all()]


@router.post("/work-orders")
def create_work_order(data: WorkOrderCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    import random, string
    wo_number = "WO-" + "".join(random.choices(string.digits, k=8))
    wo = FmmsWorkOrder(wo_number=wo_number, **data.dict())
    db.add(wo)
    db.commit()
    db.refresh(wo)
    return _wo_dict(wo)


@router.patch("/work-orders/{wo_id}")
def update_work_order(wo_id: int, data: WorkOrderCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    wo = db.query(FmmsWorkOrder).filter(FmmsWorkOrder.id == wo_id).first()
    if not wo:
        raise HTTPException(404, "Work order not found")
    for k, v in data.dict(exclude_unset=True).items():
        setattr(wo, k, v)
    db.commit()
    db.refresh(wo)
    return _wo_dict(wo)


@router.patch("/work-orders/{wo_id}/assign")
def assign_work_order(wo_id: int, assigned_to: str = Query(...), db: Session = Depends(get_db), user=Depends(get_current_user)):
    wo = db.query(FmmsWorkOrder).filter(FmmsWorkOrder.id == wo_id).first()
    if not wo:
        raise HTTPException(404, "Work order not found")
    wo.assigned_to = assigned_to
    wo.status = "assigned"
    db.commit()
    return _wo_dict(wo)


def _wo_dict(w):
    return {
        "id": w.id, "wo_number": w.wo_number, "asset_id": w.asset_id,
        "title": w.title, "description": w.description,
        "priority": w.priority, "wo_type": w.wo_type, "status": w.status,
        "requested_by": w.requested_by, "assigned_to": w.assigned_to,
        "due_date": str(w.due_date) if w.due_date else None,
        "completed_date": str(w.completed_date) if w.completed_date else None,
        "estimated_hours": w.estimated_hours, "actual_hours": w.actual_hours,
        "auto_generated": bool(w.auto_generated),
        "created_at": str(w.created_at) if w.created_at else None,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# PIC Assignment
# ═══════════════════════════════════════════════════════════════════════════════
class PicAssignCreate(BaseModel):
    work_order_id: int
    pic_user: str
    role: Optional[str] = "lead"
    remarks: Optional[str] = None


@router.get("/pic-assignments")
def list_pic_assignments(work_order_id: Optional[int] = None, db: Session = Depends(get_db), user=Depends(get_current_user)):
    q = db.query(FmmsPicAssignment)
    if work_order_id:
        q = q.filter(FmmsPicAssignment.work_order_id == work_order_id)
    return [{"id": p.id, "work_order_id": p.work_order_id, "pic_user": p.pic_user,
             "role": p.role, "status": p.status, "remarks": p.remarks,
             "assigned_date": str(p.assigned_date) if p.assigned_date else None} for p in q.all()]


@router.post("/pic-assignments")
def create_pic_assignment(data: PicAssignCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    p = FmmsPicAssignment(**data.dict())
    db.add(p)
    db.commit()
    db.refresh(p)
    return {"id": p.id, "work_order_id": p.work_order_id, "pic_user": p.pic_user, "status": p.status}


# ═══════════════════════════════════════════════════════════════════════════════
# PIC Allocation Master (technicians)
# ═══════════════════════════════════════════════════════════════════════════════
class PicTechnicianCreate(BaseModel):
    employee_code: str
    name: str
    craft: Optional[str] = "general"
    skill_level: Optional[str] = "senior"
    phone: Optional[str] = None
    email: Optional[str] = None
    department: Optional[str] = None
    is_active: Optional[bool] = True
    linked_operator_id: Optional[int] = None
    notes: Optional[str] = None


class PicTechnicianUpdate(BaseModel):
    employee_code: Optional[str] = None
    name: Optional[str] = None
    craft: Optional[str] = None
    skill_level: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    department: Optional[str] = None
    is_active: Optional[bool] = None
    linked_operator_id: Optional[int] = None
    notes: Optional[str] = None


def _tech_dict(t: FmmsPicTechnician):
    return {
        "id": t.id,
        "employee_code": t.employee_code,
        "name": t.name,
        "craft": t.craft,
        "skill_level": t.skill_level,
        "phone": t.phone,
        "email": t.email,
        "department": t.department,
        "is_active": bool(t.is_active),
        "linked_operator_id": t.linked_operator_id,
        "notes": t.notes,
        "created_at": str(t.created_at) if t.created_at else None,
        "updated_at": str(t.updated_at) if t.updated_at else None,
    }


@router.get("/pic-technicians")
def list_pic_technicians(
    active_only: bool = True,
    q: Optional[str] = None,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    query = db.query(FmmsPicTechnician)
    if active_only:
        query = query.filter(FmmsPicTechnician.is_active == 1)
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(
            (FmmsPicTechnician.employee_code.ilike(like)) | (FmmsPicTechnician.name.ilike(like))
        )
    return [_tech_dict(t) for t in query.order_by(FmmsPicTechnician.employee_code.asc()).all()]


@router.post("/pic-technicians")
def create_pic_technician(data: PicTechnicianCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    code = (data.employee_code or "").strip()
    if not code or not (data.name or "").strip():
        raise HTTPException(400, "employee_code and name are required")
    exists = db.query(FmmsPicTechnician).filter(FmmsPicTechnician.employee_code == code).first()
    if exists:
        raise HTTPException(400, f"Technician with code {code} already exists")
    t = FmmsPicTechnician(
        employee_code=code,
        name=data.name.strip(),
        craft=data.craft or "general",
        skill_level=data.skill_level or "senior",
        phone=data.phone,
        email=data.email,
        department=data.department,
        is_active=1 if data.is_active is not False else 0,
        linked_operator_id=data.linked_operator_id,
        notes=data.notes,
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    return _tech_dict(t)


@router.put("/pic-technicians/{tech_id}")
def update_pic_technician(tech_id: int, data: PicTechnicianUpdate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    t = db.query(FmmsPicTechnician).filter(FmmsPicTechnician.id == tech_id).first()
    if not t:
        raise HTTPException(404, "Technician not found")
    payload = data.dict(exclude_unset=True)
    if "is_active" in payload and payload["is_active"] is not None:
        payload["is_active"] = 1 if payload["is_active"] else 0
    if "employee_code" in payload and payload["employee_code"]:
        payload["employee_code"] = payload["employee_code"].strip()
        clash = (
            db.query(FmmsPicTechnician)
            .filter(FmmsPicTechnician.employee_code == payload["employee_code"], FmmsPicTechnician.id != tech_id)
            .first()
        )
        if clash:
            raise HTTPException(400, f"Technician with code {payload['employee_code']} already exists")
    for k, v in payload.items():
        setattr(t, k, v)
    db.commit()
    db.refresh(t)
    return _tech_dict(t)


# ═══════════════════════════════════════════════════════════════════════════════
# PM / C Planning (6-month horizon, max 3 modifications)
# ═══════════════════════════════════════════════════════════════════════════════
class PmcPlanCreate(BaseModel):
    asset_id: int
    plan_type: Optional[str] = "pm"  # pm | calibration | issue
    title: str
    description: Optional[str] = None
    pic_technician_id: Optional[int] = None
    planned_date: date
    due_date: Optional[date] = None
    remarks: Optional[str] = None
    horizon_start: Optional[date] = None
    horizon_end: Optional[date] = None
    status: Optional[str] = "planned"


class PmcPlanUpdate(BaseModel):
    asset_id: Optional[int] = None
    plan_type: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    pic_technician_id: Optional[int] = None
    planned_date: Optional[date] = None
    due_date: Optional[date] = None
    remarks: Optional[str] = None
    horizon_start: Optional[date] = None
    horizon_end: Optional[date] = None
    status: Optional[str] = None


def _resolve_pic_user(db: Session, pic_technician_id: Optional[int]) -> Optional[str]:
    if not pic_technician_id:
        return None
    tech = db.query(FmmsPicTechnician).filter(FmmsPicTechnician.id == pic_technician_id).first()
    if not tech:
        raise HTTPException(400, "PIC technician not found")
    return tech.employee_code


def _pmc_dict(p: FmmsPmcPlan):
    return {
        "id": p.id,
        "plan_number": p.plan_number,
        "asset_id": p.asset_id,
        "plan_type": p.plan_type,
        "title": p.title,
        "description": p.description,
        "pic_technician_id": p.pic_technician_id,
        "pic_user": p.pic_user,
        "planned_date": str(p.planned_date) if p.planned_date else None,
        "due_date": str(p.due_date) if p.due_date else None,
        "status": p.status,
        "modification_count": int(p.modification_count or 0),
        "max_modifications": PMC_MAX_MODIFICATIONS,
        "horizon_start": str(p.horizon_start) if p.horizon_start else None,
        "horizon_end": str(p.horizon_end) if p.horizon_end else None,
        "remarks": p.remarks,
        "created_by": p.created_by,
        "created_at": str(p.created_at) if p.created_at else None,
        "updated_at": str(p.updated_at) if p.updated_at else None,
    }


@router.get("/pmc-plans")
def list_pmc_plans(
    horizon_start: Optional[date] = None,
    horizon_end: Optional[date] = None,
    asset_id: Optional[int] = None,
    plan_type: Optional[str] = None,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    q = db.query(FmmsPmcPlan)
    if asset_id:
        q = q.filter(FmmsPmcPlan.asset_id == asset_id)
    if plan_type:
        q = q.filter(FmmsPmcPlan.plan_type == plan_type)
    if horizon_start:
        q = q.filter(FmmsPmcPlan.planned_date >= horizon_start)
    if horizon_end:
        q = q.filter(FmmsPmcPlan.planned_date <= horizon_end)
    return [_pmc_dict(p) for p in q.order_by(FmmsPmcPlan.planned_date.asc(), FmmsPmcPlan.id.desc()).all()]


@router.post("/pmc-plans")
def create_pmc_plan(data: PmcPlanCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    asset = db.query(FmmsAsset).filter(FmmsAsset.id == data.asset_id).first()
    if not asset:
        raise HTTPException(404, "Asset not found")
    plan_type = (data.plan_type or "pm").lower()
    if plan_type not in ("pm", "calibration", "issue"):
        raise HTTPException(400, "plan_type must be pm, calibration, or issue")
    h_start = data.horizon_start or data.planned_date
    h_end = data.horizon_end or (data.planned_date + timedelta(days=180))
    if data.planned_date < h_start or data.planned_date > h_end:
        raise HTTPException(400, "planned_date must fall within the 6-month feasibility horizon")
    pic_user = _resolve_pic_user(db, data.pic_technician_id)
    import random, string
    plan_number = "PMC-" + "".join(random.choices(string.digits, k=8))
    username = getattr(user, "username", None) or getattr(user, "sub", None) or "system"
    p = FmmsPmcPlan(
        plan_number=plan_number,
        asset_id=data.asset_id,
        plan_type=plan_type,
        title=data.title.strip(),
        description=data.description,
        pic_technician_id=data.pic_technician_id,
        pic_user=pic_user,
        planned_date=data.planned_date,
        due_date=data.due_date,
        status=data.status or "planned",
        modification_count=0,
        horizon_start=h_start,
        horizon_end=h_end,
        remarks=data.remarks,
        created_by=str(username),
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return _pmc_dict(p)


@router.patch("/pmc-plans/{plan_id}")
def update_pmc_plan(plan_id: int, data: PmcPlanUpdate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    p = db.query(FmmsPmcPlan).filter(FmmsPmcPlan.id == plan_id).first()
    if not p:
        raise HTTPException(404, "PM/C plan not found")
    if int(p.modification_count or 0) >= PMC_MAX_MODIFICATIONS:
        raise HTTPException(
            400,
            f"Plan {p.plan_number} has reached the maximum of {PMC_MAX_MODIFICATIONS} modifications",
        )
    payload = data.dict(exclude_unset=True)
    if "asset_id" in payload and payload["asset_id"]:
        asset = db.query(FmmsAsset).filter(FmmsAsset.id == payload["asset_id"]).first()
        if not asset:
            raise HTTPException(404, "Asset not found")
    if "plan_type" in payload and payload["plan_type"]:
        pt = payload["plan_type"].lower()
        if pt not in ("pm", "calibration", "issue"):
            raise HTTPException(400, "plan_type must be pm, calibration, or issue")
        payload["plan_type"] = pt
    if "pic_technician_id" in payload:
        payload["pic_user"] = _resolve_pic_user(db, payload["pic_technician_id"])
    planned = payload.get("planned_date", p.planned_date)
    h_start = payload.get("horizon_start", p.horizon_start) or planned
    h_end = payload.get("horizon_end", p.horizon_end) or (planned + timedelta(days=180) if planned else None)
    if planned and h_start and h_end and (planned < h_start or planned > h_end):
        raise HTTPException(400, "planned_date must fall within the 6-month feasibility horizon")
    for k, v in payload.items():
        setattr(p, k, v)
    p.modification_count = int(p.modification_count or 0) + 1
    db.commit()
    db.refresh(p)
    return _pmc_dict(p)


# ═══════════════════════════════════════════════════════════════════════════════
# Compliance Management
# ═══════════════════════════════════════════════════════════════════════════════
class ComplianceCreate(BaseModel):
    asset_id: Optional[int] = None
    regulation_name: str
    compliance_type: Optional[str] = None
    status: Optional[str] = "pending"
    due_date: Optional[date] = None
    auditor: Optional[str] = None
    certificate_number: Optional[str] = None
    remarks: Optional[str] = None


@router.get("/compliance")
def list_compliance(db: Session = Depends(get_db), user=Depends(get_current_user)):
    return [_comp_dict(c) for c in db.query(FmmsCompliance).order_by(FmmsCompliance.id.desc()).all()]


@router.post("/compliance")
def create_compliance(data: ComplianceCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    c = FmmsCompliance(**data.dict())
    db.add(c)
    db.commit()
    db.refresh(c)
    return _comp_dict(c)


def _comp_dict(c):
    return {
        "id": c.id, "asset_id": c.asset_id, "regulation_name": c.regulation_name,
        "compliance_type": c.compliance_type, "status": c.status,
        "due_date": str(c.due_date) if c.due_date else None,
        "last_audit_date": str(c.last_audit_date) if c.last_audit_date else None,
        "next_audit_date": str(c.next_audit_date) if c.next_audit_date else None,
        "auditor": c.auditor, "certificate_number": c.certificate_number, "remarks": c.remarks,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# Real-time Asset Monitoring
# ═══════════════════════════════════════════════════════════════════════════════
class MonitorDataCreate(BaseModel):
    asset_id: int
    parameter: str
    value: float
    unit: Optional[str] = None
    threshold_min: Optional[float] = None
    threshold_max: Optional[float] = None


@router.get("/monitoring")
def list_monitoring(asset_id: Optional[int] = None, db: Session = Depends(get_db), user=Depends(get_current_user)):
    q = db.query(FmmsAssetMonitor).order_by(FmmsAssetMonitor.id.desc()).limit(500)
    if asset_id:
        q = q.filter(FmmsAssetMonitor.asset_id == asset_id)
    return [{"id": m.id, "asset_id": m.asset_id, "parameter": m.parameter,
             "value": m.value, "unit": m.unit, "threshold_min": m.threshold_min,
             "threshold_max": m.threshold_max, "alert_triggered": bool(m.alert_triggered),
             "recorded_at": str(m.recorded_at) if m.recorded_at else None} for m in q.all()]


@router.post("/monitoring")
def create_monitor_entry(data: MonitorDataCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    alert = 0
    if data.threshold_max and data.value > data.threshold_max:
        alert = 1
    if data.threshold_min and data.value < data.threshold_min:
        alert = 1
    m = FmmsAssetMonitor(**data.dict(), alert_triggered=alert)
    db.add(m)
    db.commit()
    db.refresh(m)
    return {"id": m.id, "alert_triggered": bool(alert)}


# ═══════════════════════════════════════════════════════════════════════════════
# Spare Parts Inventory
# ═══════════════════════════════════════════════════════════════════════════════
class SparePartCreate(BaseModel):
    part_code: str
    name: str
    category: Optional[str] = None
    location: Optional[str] = None
    quantity_on_hand: Optional[int] = 0
    reorder_level: Optional[int] = 0
    reorder_qty: Optional[int] = 1
    unit_cost: Optional[float] = 0
    supplier: Optional[str] = None
    lead_time_days: Optional[int] = None


@router.get("/spare-parts")
def list_spare_parts(db: Session = Depends(get_db), user=Depends(get_current_user)):
    return [_sp_dict(s) for s in db.query(FmmsSparePart).order_by(FmmsSparePart.id.desc()).all()]


@router.post("/spare-parts")
def create_spare_part(data: SparePartCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    sp = FmmsSparePart(**data.dict())
    db.add(sp)
    db.commit()
    db.refresh(sp)
    return _sp_dict(sp)


@router.patch("/spare-parts/{part_id}")
def update_spare_part(part_id: int, data: SparePartCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    sp = db.query(FmmsSparePart).filter(FmmsSparePart.id == part_id).first()
    if not sp:
        raise HTTPException(404, "Spare part not found")
    for k, v in data.dict(exclude_unset=True).items():
        setattr(sp, k, v)
    db.commit()
    db.refresh(sp)
    return _sp_dict(sp)


def _sp_dict(s):
    return {
        "id": s.id, "part_code": s.part_code, "name": s.name,
        "category": s.category, "location": s.location,
        "quantity_on_hand": s.quantity_on_hand, "reorder_level": s.reorder_level,
        "reorder_qty": s.reorder_qty, "unit_cost": s.unit_cost,
        "supplier": s.supplier, "lead_time_days": s.lead_time_days,
        "status": s.status,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# Centralized Incident Tracking
# ═══════════════════════════════════════════════════════════════════════════════
class IncidentCreate(BaseModel):
    title: str
    asset_id: Optional[int] = None
    description: Optional[str] = None
    severity: Optional[str] = "medium"
    incident_type: Optional[str] = None
    reported_by: Optional[str] = None
    assigned_to: Optional[str] = None


@router.get("/incidents")
def list_incidents(db: Session = Depends(get_db), user=Depends(get_current_user)):
    return [_inc_dict(i) for i in db.query(FmmsIncident).order_by(FmmsIncident.id.desc()).all()]


@router.post("/incidents")
def create_incident(data: IncidentCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    import random, string
    inc_number = "INC-" + "".join(random.choices(string.digits, k=8))
    inc = FmmsIncident(incident_number=inc_number, **data.dict())
    db.add(inc)
    db.commit()
    db.refresh(inc)
    return _inc_dict(inc)


@router.patch("/incidents/{inc_id}")
def update_incident(inc_id: int, data: IncidentCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    inc = db.query(FmmsIncident).filter(FmmsIncident.id == inc_id).first()
    if not inc:
        raise HTTPException(404, "Incident not found")
    for k, v in data.dict(exclude_unset=True).items():
        setattr(inc, k, v)
    db.commit()
    db.refresh(inc)
    return _inc_dict(inc)


@router.delete("/incidents/{inc_id}")
def delete_incident(
    inc_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_role("admin", "supervisor", "maintenance")),
):
    """Delete incident — admin / site_admin / superadmin / supervisor / maintenance only."""
    inc = db.query(FmmsIncident).filter(FmmsIncident.id == inc_id).first()
    if not inc:
        raise HTTPException(404, "Incident not found")
    number = inc.incident_number
    db.delete(inc)
    db.commit()
    return {"ok": True, "deleted": number, "id": inc_id}


def _inc_dict(i):
    return {
        "id": i.id, "incident_number": i.incident_number, "asset_id": i.asset_id,
        "title": i.title, "description": i.description,
        "severity": i.severity, "incident_type": i.incident_type,
        "status": i.status, "reported_by": i.reported_by, "assigned_to": i.assigned_to,
        "reported_at": str(i.reported_at) if i.reported_at else None,
        "resolved_at": str(i.resolved_at) if i.resolved_at else None,
        "root_cause": i.root_cause, "corrective_action": i.corrective_action,
        "preventive_action": i.preventive_action,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# FMMS Dashboard Summary
# ═══════════════════════════════════════════════════════════════════════════════
@router.get("/dashboard")
def fmms_dashboard(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Summary stats for the FMMS landing page (includes CAL-03 / MGT-02 compliance %)."""
    today = date.today()
    scheduled = db.query(FmmsAsset).filter(FmmsAsset.next_service_date.isnot(None)).all()
    total_cal = len(scheduled) or 0
    overdue = sum(1 for a in scheduled if a.next_service_date and a.next_service_date < today)
    due_soon = sum(
        1 for a in scheduled
        if a.next_service_date and today <= a.next_service_date <= today + timedelta(days=int(a.alert_before_days or 7))
    )
    on_track = max(0, total_cal - overdue - due_soon)
    compliance_pct = round(100.0 * on_track / total_cal, 1) if total_cal else 100.0

    # Group / BU rollup (MGT-01) — department or business_unit
    bu_map: dict[str, int] = {}
    for a in db.query(FmmsAsset).filter(FmmsAsset.hierarchy_level.in_(("equipment", "sub_assembly"))).all():
        bu = getattr(a, "business_unit", None) or a.department or a.location or "Unassigned"
        bu_map[bu] = bu_map.get(bu, 0) + 1

    return {
        "total_assets": db.query(FmmsAsset).count(),
        "active_work_orders": db.query(FmmsWorkOrder).filter(FmmsWorkOrder.status.in_(["open", "assigned", "in_progress"])).count(),
        "open_incidents": db.query(FmmsIncident).filter(FmmsIncident.status.in_(["reported", "investigating"])).count(),
        "low_stock_parts": db.query(FmmsSparePart).filter(FmmsSparePart.quantity_on_hand <= FmmsSparePart.reorder_level).count(),
        "pending_compliance": db.query(FmmsCompliance).filter(FmmsCompliance.status == "pending").count(),
        "calibration_compliance_pct": compliance_pct,
        "calibration_total": total_cal,
        "calibration_overdue": overdue,
        "calibration_due_soon": due_soon,
        "calibration_on_track": on_track,
        "group_view": [{"business_unit": k, "asset_count": v} for k, v in sorted(bu_map.items(), key=lambda x: -x[1])[:12]],
    }
