"""FMMS (Facility Maintenance Management System) — independent data models.

Each module has its own table. These tables are independent of PMS core tables
but can reference shared entities (machines, users) for integration.
"""
from __future__ import annotations

from sqlalchemy import (
    Column, Integer, String, Text, Float, DateTime, Date, ForeignKey, Enum
)
from .models import Base, now_ist


# Hierarchy levels (FR-01): Location → Building → Facility/Lab → Equipment → Sub-assembly
ASSET_HIERARCHY_LEVELS = ("location", "building", "facility", "equipment", "sub_assembly")
ASSET_CLASSIFICATIONS = ("critical", "non_critical")

# ─────────────────────────────────────────────────────────────────────────────
# 1. Centralized Asset Management (FR-01 … FR-04)
# ─────────────────────────────────────────────────────────────────────────────
class FmmsAsset(Base):
    __tablename__ = "fmms_assets"
    id = Column(Integer, primary_key=True, index=True)
    asset_code = Column(String(80), unique=True, nullable=False)
    name = Column(String(200), nullable=False)
    # FR-01 hierarchy
    parent_id = Column(Integer, ForeignKey("fmms_assets.id"), nullable=True, index=True)
    hierarchy_level = Column(String(30), default="equipment")  # location|building|facility|equipment|sub_assembly
    hierarchy_path = Column(String(500))  # denormalized breadcrumb e.g. LOC-001 / BLD-001 / EQ-001
    # FR-04 classification
    classification = Column(String(20), default="non_critical")  # critical | non_critical
    category = Column(String(100))
    # PMS machine mapping (Machine Configuration)
    machine_id = Column(Integer, ForeignKey("machines.id"), nullable=True, index=True)
    machine_type = Column(String(50))
    location = Column(String(200))
    building = Column(String(200))
    facility_lab = Column(String(200))
    equipment_name = Column(String(200))
    sub_assembly = Column(String(200))
    department = Column(String(100))
    business_unit = Column(String(100))  # TACO BU (Interior, Lighting, …)
    manufacturer = Column(String(200))
    image_url = Column(String(500))
    qr_code = Column(String(200))
    model_number = Column(String(100))
    serial_number = Column(String(100))
    installation_date = Column(Date)
    purchase_date = Column(Date)
    warranty_expiry = Column(Date)
    # Calibration / PM schedule + alert threshold
    schedule_type = Column(String(30), default="calibration")  # calibration | pm
    last_service_date = Column(Date)  # last calibration or last PM
    next_service_date = Column(Date)  # next calibration or next PM
    alert_before_days = Column(Integer, default=7)  # alert N days before next_service_date
    capital_investment = Column(Float, default=0)
    revenue_investment = Column(Float, default=0)
    status = Column(String(50), default="active")  # active, inactive, under_maintenance, decommissioned
    criticality = Column(String(20), default="medium")  # legacy compat; prefer classification
    notes = Column(Text)
    created_at = Column(DateTime, default=now_ist)
    updated_at = Column(DateTime, default=now_ist, onupdate=now_ist)


class FmmsAssetHistory(Base):
    """FR-03: Asset history — installation, breakdown, AMC, calibration, maintenance, investment, manpower."""
    __tablename__ = "fmms_asset_history"
    id = Column(Integer, primary_key=True, index=True)
    asset_id = Column(Integer, ForeignKey("fmms_assets.id"), nullable=False, index=True)
    event_type = Column(String(50), nullable=False)
    # installation | breakdown | amc | calibration | inhouse_maintenance | investment | manpower_cost
    title = Column(String(300), nullable=False)
    description = Column(Text)
    event_date = Column(Date)
    cost = Column(Float, default=0)
    cost_category = Column(String(30))  # revenue | capital | manpower
    reference_number = Column(String(100))
    performed_by = Column(String(100))
    created_by = Column(String(100))
    created_at = Column(DateTime, default=now_ist)


class FmmsAssetDocument(Base):
    """FR-03: Commercial documents — SOR, Quotation, PO, Invoice, inspection reports."""
    __tablename__ = "fmms_asset_documents"
    id = Column(Integer, primary_key=True, index=True)
    asset_id = Column(Integer, ForeignKey("fmms_assets.id"), nullable=False, index=True)
    doc_type = Column(String(50), nullable=False)  # sor | quotation | purchase_order | invoice | inspection_report | other
    doc_number = Column(String(100))
    title = Column(String(300))
    doc_date = Column(Date)
    amount = Column(Float, default=0)
    vendor = Column(String(200))
    file_url = Column(String(500))
    remarks = Column(Text)
    created_at = Column(DateTime, default=now_ist)


# ─────────────────────────────────────────────────────────────────────────────
# 2. Work Order Management (Automated)
# ─────────────────────────────────────────────────────────────────────────────
class FmmsWorkOrder(Base):
    __tablename__ = "fmms_work_orders"
    id = Column(Integer, primary_key=True, index=True)
    wo_number = Column(String(50), unique=True, nullable=False)
    asset_id = Column(Integer, ForeignKey("fmms_assets.id"), nullable=True)
    title = Column(String(300), nullable=False)
    description = Column(Text)
    priority = Column(String(20), default="medium")  # low, medium, high, critical
    wo_type = Column(String(50), default="corrective")  # preventive, corrective, predictive, emergency
    status = Column(String(50), default="open")  # open, assigned, in_progress, on_hold, completed, closed
    requested_by = Column(String(100))
    assigned_to = Column(String(100))  # PIC (Person In Charge)
    due_date = Column(Date)
    completed_date = Column(DateTime)
    estimated_hours = Column(Float)
    actual_hours = Column(Float)
    auto_generated = Column(Integer, default=0)  # 1 = system-generated from schedule/trigger
    created_at = Column(DateTime, default=now_ist)
    updated_at = Column(DateTime, default=now_ist, onupdate=now_ist)


# ─────────────────────────────────────────────────────────────────────────────
# 3. PIC Assignment / Allocation
# ─────────────────────────────────────────────────────────────────────────────
class FmmsPicAssignment(Base):
    __tablename__ = "fmms_pic_assignments"
    id = Column(Integer, primary_key=True, index=True)
    work_order_id = Column(Integer, ForeignKey("fmms_work_orders.id"), nullable=False)
    pic_user = Column(String(100), nullable=False)
    role = Column(String(50))  # lead, support, specialist
    assigned_date = Column(DateTime, default=now_ist)
    status = Column(String(50), default="assigned")  # assigned, accepted, declined, completed
    remarks = Column(Text)


class FmmsPicTechnician(Base):
    """PIC Allocation Master — technicians available for incident / PM / calibration PIC."""
    __tablename__ = "fmms_pic_technicians"
    id = Column(Integer, primary_key=True, index=True)
    employee_code = Column(String(50), unique=True, nullable=False)
    name = Column(String(200), nullable=False)
    craft = Column(String(50), default="general")  # mechanical, electrical, instrumentation, calibration, general
    skill_level = Column(String(30), default="senior")  # junior, senior, specialist, lead
    phone = Column(String(40))
    email = Column(String(120))
    department = Column(String(100))
    is_active = Column(Integer, default=1)
    linked_operator_id = Column(Integer, nullable=True, index=True)
    notes = Column(Text)
    created_at = Column(DateTime, default=now_ist)
    updated_at = Column(DateTime, default=now_ist, onupdate=now_ist)


class FmmsPmcPlan(Base):
    """PM / Calibration / Issue planning within a rolling 6-month feasibility horizon.
    modification_count is capped at 3 by the API.
    """
    __tablename__ = "fmms_pmc_plans"
    id = Column(Integer, primary_key=True, index=True)
    plan_number = Column(String(50), unique=True, nullable=False)
    asset_id = Column(Integer, ForeignKey("fmms_assets.id"), nullable=False, index=True)
    plan_type = Column(String(30), default="pm")  # pm | calibration | issue
    title = Column(String(300), nullable=False)
    description = Column(Text)
    pic_technician_id = Column(Integer, ForeignKey("fmms_pic_technicians.id"), nullable=True, index=True)
    pic_user = Column(String(100))  # denormalized employee_code / display
    planned_date = Column(Date, nullable=False, index=True)
    due_date = Column(Date)
    status = Column(String(50), default="planned")  # planned, scheduled, in_progress, completed, cancelled
    modification_count = Column(Integer, default=0)
    horizon_start = Column(Date)
    horizon_end = Column(Date)
    remarks = Column(Text)
    created_by = Column(String(100))
    created_at = Column(DateTime, default=now_ist)
    updated_at = Column(DateTime, default=now_ist, onupdate=now_ist)


# ─────────────────────────────────────────────────────────────────────────────
# 4. Compliance Management
# ─────────────────────────────────────────────────────────────────────────────
class FmmsCompliance(Base):
    __tablename__ = "fmms_compliance"
    id = Column(Integer, primary_key=True, index=True)
    asset_id = Column(Integer, ForeignKey("fmms_assets.id"), nullable=True)
    regulation_name = Column(String(200), nullable=False)
    compliance_type = Column(String(100))  # safety, environmental, quality, regulatory
    status = Column(String(50), default="pending")  # pending, compliant, non_compliant, expired
    due_date = Column(Date)
    last_audit_date = Column(Date)
    next_audit_date = Column(Date)
    auditor = Column(String(100))
    certificate_number = Column(String(100))
    remarks = Column(Text)
    created_at = Column(DateTime, default=now_ist)
    updated_at = Column(DateTime, default=now_ist, onupdate=now_ist)


# ─────────────────────────────────────────────────────────────────────────────
# 5. Real-time Asset Monitoring
# ─────────────────────────────────────────────────────────────────────────────
class FmmsAssetMonitor(Base):
    __tablename__ = "fmms_asset_monitoring"
    id = Column(Integer, primary_key=True, index=True)
    asset_id = Column(Integer, ForeignKey("fmms_assets.id"), nullable=False)
    parameter = Column(String(100), nullable=False)  # temperature, vibration, pressure, etc.
    value = Column(Float)
    unit = Column(String(30))
    threshold_min = Column(Float)
    threshold_max = Column(Float)
    alert_triggered = Column(Integer, default=0)
    recorded_at = Column(DateTime, default=now_ist)


# ─────────────────────────────────────────────────────────────────────────────
# 6. Spare Parts Inventory
# ─────────────────────────────────────────────────────────────────────────────
class FmmsSparePart(Base):
    __tablename__ = "fmms_spare_parts"
    id = Column(Integer, primary_key=True, index=True)
    part_code = Column(String(50), unique=True, nullable=False)
    name = Column(String(200), nullable=False)
    category = Column(String(100))
    location = Column(String(200))  # storage bin/rack
    quantity_on_hand = Column(Integer, default=0)
    reorder_level = Column(Integer, default=0)
    reorder_qty = Column(Integer, default=1)
    unit_cost = Column(Float, default=0)
    supplier = Column(String(200))
    lead_time_days = Column(Integer)
    linked_asset_ids = Column(Text)  # JSON list of asset IDs that use this part
    status = Column(String(50), default="available")  # available, low_stock, out_of_stock
    created_at = Column(DateTime, default=now_ist)
    updated_at = Column(DateTime, default=now_ist, onupdate=now_ist)


# ─────────────────────────────────────────────────────────────────────────────
# 7. Centralized Incident Tracking
# ─────────────────────────────────────────────────────────────────────────────
class FmmsIncident(Base):
    __tablename__ = "fmms_incidents"
    id = Column(Integer, primary_key=True, index=True)
    incident_number = Column(String(50), unique=True, nullable=False)
    asset_id = Column(Integer, ForeignKey("fmms_assets.id"), nullable=True)
    title = Column(String(300), nullable=False)
    description = Column(Text)
    severity = Column(String(20), default="medium")  # low, medium, high, critical
    incident_type = Column(String(100))  # safety, equipment_failure, environmental, near_miss
    status = Column(String(50), default="reported")  # reported, investigating, resolved, closed
    reported_by = Column(String(100))
    assigned_to = Column(String(100))
    reported_at = Column(DateTime, default=now_ist)
    resolved_at = Column(DateTime)
    root_cause = Column(Text)
    corrective_action = Column(Text)
    preventive_action = Column(Text)
    created_at = Column(DateTime, default=now_ist)
    updated_at = Column(DateTime, default=now_ist, onupdate=now_ist)
