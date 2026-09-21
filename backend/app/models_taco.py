"""TATA AutoComp (TACO) FMMS extensions — vendor calibration + testing equipment sharing."""
from __future__ import annotations

from sqlalchemy import Column, Integer, String, Text, Float, DateTime, Date, Boolean
from .models import Base, now_ist


class TacoVendor(Base):
    """CAL-10 Approved Calibration Lab / Vendor Master."""
    __tablename__ = "taco_vendors"
    id = Column(Integer, primary_key=True, index=True)
    vendor_code = Column(String(40), unique=True, nullable=False)
    name = Column(String(200), nullable=False)
    vendor_type = Column(String(50), default="calibration_lab")  # calibration_lab | service | oem
    accreditation = Column(String(100))  # NABL / ISO
    contact_email = Column(String(200))
    contact_phone = Column(String(50))
    city = Column(String(100))
    status = Column(String(30), default="approved")  # approved | pending | rejected | suspended
    rating = Column(Float, default=0)
    turnaround_days = Column(Integer, default=7)
    pending_reason = Column(Text)  # why waiting for approval
    decision_reason = Column(Text)  # approve/reject comments
    reviewed_by = Column(String(100))
    reviewed_at = Column(DateTime)
    notes = Column(Text)
    created_at = Column(DateTime, default=now_ist)
    updated_at = Column(DateTime, default=now_ist, onupdate=now_ist)


class TacoVendorEquipmentMap(Base):
    """CAL-09 Vendor mapping to equipment / instrument types."""
    __tablename__ = "taco_vendor_equipment_map"
    id = Column(Integer, primary_key=True, index=True)
    vendor_id = Column(Integer, nullable=False, index=True)
    asset_code = Column(String(80), index=True)
    equipment_type = Column(String(100))
    business_unit = Column(String(100))
    preferred = Column(Boolean, default=True)
    remarks = Column(Text)
    created_at = Column(DateTime, default=now_ist)


class TacoVendorRateCard(Base):
    """CAL-11 Vendor rate card."""
    __tablename__ = "taco_vendor_rate_cards"
    id = Column(Integer, primary_key=True, index=True)
    vendor_id = Column(Integer, nullable=False, index=True)
    service_name = Column(String(200), nullable=False)
    equipment_type = Column(String(100))
    unit_rate = Column(Float, default=0)
    currency = Column(String(10), default="INR")
    lead_time_days = Column(Integer, default=7)
    effective_from = Column(Date)
    status = Column(String(30), default="active")
    created_at = Column(DateTime, default=now_ist)


class TacoVendorWorkflow(Base):
    """CAL-07 / CAL-08 Vendor notification + pickup / return workflow."""
    __tablename__ = "taco_vendor_workflows"
    id = Column(Integer, primary_key=True, index=True)
    workflow_number = Column(String(50), unique=True, nullable=False)
    asset_code = Column(String(80))
    asset_name = Column(String(200))
    business_unit = Column(String(100))
    vendor_id = Column(Integer, index=True)
    vendor_name = Column(String(200))
    stage = Column(String(40), default="notify")  # notify|pickup|at_lab|return|closed
    status = Column(String(40), default="open")  # open|in_progress|completed|cancelled
    notified_at = Column(DateTime)
    pickup_date = Column(Date)
    expected_return = Column(Date)
    actual_return = Column(Date)
    estimated_cost = Column(Float, default=0)
    actual_cost = Column(Float, default=0)
    remarks = Column(Text)
    created_by = Column(String(100))
    created_at = Column(DateTime, default=now_ist)
    updated_at = Column(DateTime, default=now_ist, onupdate=now_ist)


class TacoCalibrationCost(Base):
    """CAL-12 / CAL-13 Calibration cost tracking by BU / Group."""
    __tablename__ = "taco_calibration_costs"
    id = Column(Integer, primary_key=True, index=True)
    period_month = Column(String(7), nullable=False)  # YYYY-MM
    business_unit = Column(String(100), nullable=False)
    group_name = Column(String(100), default="TATA AutoComp")
    asset_code = Column(String(80))
    vendor_name = Column(String(200))
    cost_amount = Column(Float, default=0)
    cost_type = Column(String(40), default="calibration")  # calibration | freight | urgent
    remarks = Column(Text)
    created_at = Column(DateTime, default=now_ist)


class TacoTestingEquipment(Base):
    """TEST-01..04 Testing equipment repository with BU ownership / availability."""
    __tablename__ = "taco_testing_equipment"
    id = Column(Integer, primary_key=True, index=True)
    equipment_code = Column(String(80), unique=True, nullable=False)
    name = Column(String(200), nullable=False)
    equipment_type = Column(String(100))
    owning_bu = Column(String(100), nullable=False)
    location = Column(String(200))
    status = Column(String(40), default="available")  # available|booked|maintenance|calibration
    utilization_pct = Column(Float, default=0)
    shareable = Column(Boolean, default=True)
    capacity_slots_per_day = Column(Integer, default=4)
    # Configurable booking durations (minutes), e.g. "30,60,120"
    duration_options_min = Column(String(100), default="30,60,120")
    default_duration_min = Column(Integer, default=60)
    day_start = Column(String(10), default="09:00")
    day_end = Column(String(10), default="18:00")
    cost_per_hour = Column(Float, default=0)  # INR charge for shared testing
    notes = Column(Text)
    created_at = Column(DateTime, default=now_ist)
    updated_at = Column(DateTime, default=now_ist, onupdate=now_ist)


class TacoTestingBooking(Base):
    """TEST-05..10 Slot booking / reservation."""
    __tablename__ = "taco_testing_bookings"
    id = Column(Integer, primary_key=True, index=True)
    booking_number = Column(String(50), unique=True, nullable=False)
    equipment_id = Column(Integer, nullable=False, index=True)
    equipment_code = Column(String(80))
    equipment_name = Column(String(200))
    owning_bu = Column(String(100))
    requesting_bu = Column(String(100), nullable=False)
    requested_by = Column(String(100))
    booking_date = Column(Date, nullable=False)
    slot_start = Column(String(10))  # HH:MM
    slot_end = Column(String(10))
    duration_min = Column(Integer, default=60)
    asset_under_test = Column(String(120))  # asset / part under test
    asset_under_test_name = Column(String(200))
    fmms_wo_number = Column(String(50))  # linked FMMS work order
    cost_amount = Column(Float, default=0)
    priority = Column(String(20), default="normal")  # owner_priority | normal | low
    status = Column(String(40), default="requested")  # requested|confirmed|in_use|completed|cancelled
    purpose = Column(Text)
    submitted_at = Column(DateTime, default=now_ist)
    decision_reason = Column(Text)
    reviewed_by = Column(String(100))
    reviewed_at = Column(DateTime)
    created_at = Column(DateTime, default=now_ist)
    updated_at = Column(DateTime, default=now_ist, onupdate=now_ist)


class TacoReservationRule(Base):
    """TEST-09 Priority reservation rules for owning BU."""
    __tablename__ = "taco_reservation_rules"
    id = Column(Integer, primary_key=True, index=True)
    rule_name = Column(String(200), nullable=False)
    owning_bu = Column(String(100), nullable=False)
    priority_window_hours = Column(Integer, default=48)
    max_external_share_pct = Column(Float, default=40)
    auto_approve_owner = Column(Boolean, default=True)
    active = Column(Boolean, default=True)
    remarks = Column(Text)
    created_at = Column(DateTime, default=now_ist)
