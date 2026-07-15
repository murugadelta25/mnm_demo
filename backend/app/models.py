from sqlalchemy import create_engine, Column, Integer, String, Date, Time, DateTime, Numeric, Float, Text, Enum, ForeignKey, TIMESTAMP, Computed
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
from dotenv import load_dotenv
import os
from pathlib import Path

_env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(_env_path, encoding="utf-8-sig")

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError(f"DATABASE_URL is not set. Check {_env_path}")
engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_recycle=3600,
    connect_args={"connect_timeout": 10},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def ensure_oee_schema(bind=None):
    """Ensure legacy databases have the raw OEE columns used for audit tracking."""
    if bind is None:
        bind = engine

    try:
        from sqlalchemy import inspect, text

        inspector = inspect(bind)
        if not inspector.has_table("oee_entries"):
            return False

        columns = {column["name"] for column in inspector.get_columns("oee_entries")}
        with bind.begin() as conn:
            if "ar_raw" not in columns:
                conn.execute(text("ALTER TABLE oee_entries ADD COLUMN ar_raw DECIMAL(7, 2) NULL"))
            if "pr_raw" not in columns:
                conn.execute(text("ALTER TABLE oee_entries ADD COLUMN pr_raw DECIMAL(7, 2) NULL"))
            if "qr_raw" not in columns:
                conn.execute(text("ALTER TABLE oee_entries ADD COLUMN qr_raw DECIMAL(7, 2) NULL"))
            if "oee_raw" not in columns:
                conn.execute(text("ALTER TABLE oee_entries ADD COLUMN oee_raw DECIMAL(7, 2) NULL"))
        return True
    except Exception:
        return False


ensure_oee_schema()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

import pytz as _pytz
_IST = _pytz.timezone('Asia/Kolkata')
def now_ist():
    """Return current IST datetime (naive, for DB storage)."""
    from datetime import datetime
    return datetime.now(_IST).replace(tzinfo=None)

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    role = Column(Enum("operator", "supervisor", "maintenance", "admin", "quality"), nullable=False)

class Station(Base):
    __tablename__ = "stations"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False)
    display_name = Column(String(100), nullable=False)
    created_at = Column(TIMESTAMP, server_default="CURRENT_TIMESTAMP")

# Backward import alias during transition
Pair = Station

class Machine(Base):
    __tablename__ = "machines"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    station_id = Column(Integer, ForeignKey("stations.id"), nullable=False)
    status = Column(Enum("running", "idle", "breakdown", "setting_change", "alarm", "offline"), default="idle")
    machine_type = Column(String(50), default="CNC")
    make = Column(String(100))
    model_no = Column(String(100))
    tonnage = Column(String(50))
    features = Column(Text)
    image_url = Column(String(500))
    location = Column(String(100))
    plc_source = Column(Enum("manual", "mqtt", "modbus", "opcua"), default="manual")
    plc_endpoint = Column(String(255))
    plc_topic = Column(String(255))

class OEEEntry(Base):
    __tablename__ = "oee_entries"
    id = Column(Integer, primary_key=True, index=True)
    entry_date = Column(Date, nullable=False)
    station_no = Column(Integer, nullable=False)
    machine_id = Column(Integer, ForeignKey("machines.id"), nullable=True)
    shift = Column(String(1), nullable=False)
    current_operation = Column(String(50))
    next_operation = Column(String(50))
    model_variant = Column(String(100))
    process_time = Column(Numeric(10, 2))
    loading_unloading = Column(Numeric(10, 2))
    cycle_time = Column(Numeric(10, 2), Computed('(`process_time` + `loading_unloading`)'))
    start_time = Column(String(10))
    stop_time = Column(String(10))
    total_minutes = Column(Integer)
    lunch_break = Column(Integer, default=0)
    tea_break = Column(Integer, default=0)
    tpm_cleaning = Column(Integer, default=0)
    other_cleaning = Column(Integer, default=0)
    management_meeting = Column(Integer, default=0)
    total_breaks = Column(Integer, Computed('((((`lunch_break` + `tea_break`) + `tpm_cleaning`) + `other_cleaning`) + `management_meeting`)'))
    shift_working_minutes = Column(Integer, Computed('(`total_minutes` - ((((`lunch_break` + `tea_break`) + `tpm_cleaning`) + `other_cleaning`) + `management_meeting`))'))
    no_load = Column(Integer, default=0)
    new_model_trial = Column(Integer, default=0)
    power_cut = Column(Integer, default=0)
    planned_maintenance = Column(Integer, default=0)
    no_manpower_planned = Column(Integer, default=0)
    management_loss_total = Column(Integer, Computed('((((`no_load` + `new_model_trial`) + `power_cut`) + `planned_maintenance`) + `no_manpower_planned`)'))
    available_shift_time = Column(Integer)
    setting_time = Column(Integer, default=0)
    tool_change = Column(Integer, default=0)
    dimension_correction = Column(Integer, default=0)
    scrap_removal = Column(Integer, default=0)
    break_down = Column(Integer, default=0)
    total_down_time = Column(Integer, Computed('((((`setting_time` + `tool_change`) + `dimension_correction`) + `scrap_removal`) + `break_down`)'))
    operating_time = Column(Integer)
    possible_qty = Column(Integer)
    production_loss = Column(Integer, Computed('(`possible_qty` - `actual_qty`)'))
    actual_qty = Column(Integer)
    accp_qty = Column(Integer)
    defect_qty = Column(Integer)
    ar = Column(Numeric(6, 2))
    pr = Column(Numeric(6, 2))
    qr = Column(Numeric(6, 2))
    oee = Column(Numeric(6, 2))
    # Original uncapped values — stored for audit; NULL means no capping occurred
    ar_raw  = Column(Numeric(7, 2), nullable=True)
    pr_raw  = Column(Numeric(7, 2), nullable=True)
    qr_raw  = Column(Numeric(7, 2), nullable=True)
    oee_raw = Column(Numeric(7, 2), nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"))

class ModelChangeRequest(Base):
    __tablename__ = "model_change_requests"
    id = Column(Integer, primary_key=True, index=True)
    machine_id = Column(Integer, ForeignKey("machines.id"), nullable=False)
    plan_id = Column(Integer, ForeignKey("production_plans.id"), nullable=True)
    requested_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    approved_by = Column(Integer, ForeignKey("users.id"))
    from_model = Column(String(100))
    to_model = Column(String(100))
    status = Column(Enum("pending", "approved", "in_progress", "completed", "rejected"), default="pending")
    ideal_minutes = Column(Integer, default=60)
    shift = Column(String(1), default="A")
    entry_date = Column(Date)
    reason = Column(String(50), default="setting_change")
    start_time = Column(DateTime)
    end_time = Column(DateTime)
    created_at = Column(TIMESTAMP)

class WorkOrder(Base):
    __tablename__ = "work_orders"
    id = Column(Integer, primary_key=True, index=True)
    work_order_no = Column(String(100), unique=True, nullable=False)
    part_id = Column(Integer, ForeignKey("parts.id"))
    model_variant = Column(String(100))
    description = Column(String(255))
    target_qty = Column(Integer, nullable=False)
    start_date = Column(Date)
    end_date = Column(Date)
    status = Column(Enum("draft", "in_progress", "completed", "cancelled"), default="draft")
    spares_tools_json = Column(Text)
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(TIMESTAMP)
    updated_at = Column(TIMESTAMP)


class ProductionPlan(Base):
    __tablename__ = "production_plans"
    id = Column(Integer, primary_key=True, index=True)
    work_order_id = Column(Integer, ForeignKey("work_orders.id"))
    plan_date = Column(Date, nullable=False)
    shift = Column(String(1), nullable=False)
    station_no = Column(Integer, nullable=False)
    machine_id = Column(Integer, ForeignKey("machines.id"))
    current_operation = Column(String(50), nullable=False)
    next_operation = Column(String(50), nullable=False)
    model_variant = Column(String(100))
    process_time = Column(Numeric(10, 2), nullable=False)
    loading_unloading = Column(Numeric(10, 2), default=10)
    planned_qty = Column(Integer, nullable=False)
    actual_qty = Column(Integer, default=0)
    priority = Column(Integer, default=1)
    status = Column(Enum("pending","running","completed","paused","cancelled"), default="pending")
    plan_type = Column(Enum("scheduled","urgent","trial"), default="scheduled")
    notes = Column(Text)
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(TIMESTAMP)
    updated_at = Column(TIMESTAMP)

class EmailGroup(Base):
    __tablename__ = "email_groups"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(50), unique=True, nullable=False)
    description = Column(String(200))
    report_types = Column(String(100), default="oee,planning,breakdown")

class EmailRecipient(Base):
    __tablename__ = "email_recipients"
    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(Integer, ForeignKey("email_groups.id"), nullable=False)
    name = Column(String(100), nullable=False)
    email = Column(String(150), nullable=False)
    active = Column(Integer, default=1)

class EmailSchedule(Base):
    __tablename__ = "email_schedules"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    group_ids = Column(String(200), nullable=False)  # comma-separated group ids
    report_type = Column(String(50), default="daily")
    send_hour = Column(Integer, default=18)
    send_minute = Column(Integer, default=0)
    attach_report = Column(Integer, default=1)
    active = Column(Integer, default=1)
    last_sent = Column(DateTime)

class EmailSmtpConfig(Base):
    __tablename__ = "email_smtp_config"
    id = Column(Integer, primary_key=True, index=True)
    smtp_server = Column(String(100), default="smtp.gmail.com")
    smtp_port = Column(Integer, default=587)
    email_address = Column(String(150))
    email_password = Column(String(255))

class SiteConfig(Base):
    __tablename__ = "site_config"
    id = Column(Integer, primary_key=True, index=True)
    config_json = Column(Text, nullable=False)

class MachineStatusLog(Base):
    __tablename__ = "machine_status_log"
    id = Column(Integer, primary_key=True, index=True)
    machine_id = Column(Integer, ForeignKey("machines.id"), nullable=False)
    status = Column(String(50), nullable=False)
    changed_at = Column(DateTime, nullable=False)
    source = Column(String(50), default="system")
    deviation_reason = Column(String(500), nullable=True)

class EmailLog(Base):
    __tablename__ = "email_logs"
    id = Column(Integer, primary_key=True, index=True)
    sent_at = Column(TIMESTAMP, nullable=False)
    recipients = Column(Text)          # comma-separated emails
    subject = Column(String(255))
    report_type = Column(String(50))   # planning | manual | scheduled
    status = Column(String(20), default="sent")  # sent | failed
    error_msg = Column(Text)
    sent_by = Column(Integer, ForeignKey("users.id"))

class DeviationAlertLog(Base):
    """Tracks deviation / breakdown / alarm alert emails sent (dedup + audit)."""
    __tablename__ = "deviation_alert_log"
    id = Column(Integer, primary_key=True, index=True)
    sent_at = Column(DateTime, nullable=False)
    alert_type = Column(String(50), nullable=False)
    machine_id = Column(Integer, ForeignKey("machines.id"), nullable=False)
    status = Column(String(50), nullable=False)
    segment_log_id = Column(Integer, ForeignKey("machine_status_log.id"), nullable=True)
    breach_count = Column(Integer, default=1)
    duration_sec = Column(Integer)
    deviation_reason = Column(String(500))
    recipients = Column(Text)
    subject = Column(String(255))
    email_log_id = Column(Integer, ForeignKey("email_logs.id"), nullable=True)
    delivery_status = Column(String(20), default="sent")
    escalation_level = Column(Integer, default=0)  # 0 = all recipients; 1+ = escalation tier


class DeviationEscalationCase(Base):
    """Open deviation case tracked for multi-level escalation until action is taken."""
    __tablename__ = "deviation_escalation_cases"
    id = Column(Integer, primary_key=True, index=True)
    segment_log_id = Column(Integer, ForeignKey("machine_status_log.id"), nullable=True)
    machine_id = Column(Integer, ForeignKey("machines.id"), nullable=False)
    status = Column(String(50), nullable=False)
    alert_type = Column(String(50), nullable=False)
    current_level = Column(Integer, default=1)
    opened_at = Column(DateTime, nullable=False)
    last_escalated_at = Column(DateTime, nullable=False)
    resolved_at = Column(DateTime, nullable=True)
    resolved_reason = Column(String(100), nullable=True)


class OEEDefectLog(Base):
    """Tracks before/after OEE when defect_qty is updated post-QC"""
    __tablename__ = "oee_defect_log"
    id           = Column(Integer, primary_key=True, index=True)
    oee_entry_id = Column(Integer, ForeignKey("oee_entries.id"), nullable=False)
    updated_at   = Column(DateTime, nullable=False)
    updated_by   = Column(Integer, ForeignKey("users.id"))
    # before
    before_defect_qty = Column(Integer)
    before_accp_qty   = Column(Integer)
    before_qr         = Column(Numeric(5,2))
    before_oee        = Column(Numeric(5,2))
    # after
    after_defect_qty  = Column(Integer)
    after_accp_qty    = Column(Integer)
    after_qr          = Column(Numeric(5,2))
    after_oee         = Column(Numeric(5,2))
    note              = Column(String(500))

class BreakdownTicket(Base):
    __tablename__ = "breakdown_tickets"
    id = Column(Integer, primary_key=True, index=True)
    machine_id = Column(Integer, ForeignKey("machines.id"), nullable=False)
    raised_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    acknowledged_by = Column(Integer, ForeignKey("users.id"))
    description = Column(Text)
    status = Column(Enum("raised", "acknowledged", "in_progress", "resolved"), default="raised")
    ack_time = Column(DateTime)
    start_troubleshoot = Column(DateTime)
    resolved_time = Column(DateTime)
    resolution_notes = Column(Text)
    created_at = Column(TIMESTAMP)


class Part(Base):
    __tablename__ = "parts"
    id = Column(Integer, primary_key=True, index=True)
    part_no = Column(String(100), unique=True, nullable=False)
    part_name = Column(String(255))
    model_variant = Column(String(100))
    description = Column(String(255))
    tool_no = Column(String(50))
    no_of_cavity = Column(Integer, default=1)
    production_section = Column(String(100))
    input_material = Column(String(255))
    previous_operation = Column(String(255))
    next_operation = Column(String(255))
    machine_type = Column(String(100))
    operation_code = Column(String(100))
    operation_name = Column(String(100))
    operation_sequence = Column(Text)
    process_time = Column(Numeric(10, 2))
    loading_unloading = Column(Numeric(10, 2), default=10)
    drawing_revision = Column(String(50))
    manufacturing_status = Column(String(50), default="production")
    manufacturing_status_other = Column(String(100))
    image_url = Column(String(500))
    sketch_image_url = Column(String(500))
    qc_columns_json = Column(Text)
    tools_params_json = Column(Text)
    machine_params_json = Column(Text)
    jigs_fixtures_json = Column(Text)
    cycle_profile_json = Column(Text, nullable=True)
    active = Column(Integer, default=1)
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(TIMESTAMP)
    updated_at = Column(TIMESTAMP)


class PartDocument(Base):
    __tablename__ = "part_documents"
    id = Column(Integer, primary_key=True, index=True)
    part_id = Column(Integer, ForeignKey("parts.id"), nullable=False)
    doc_type = Column(String(100), nullable=False)
    doc_label = Column(String(150))
    revision = Column(String(20), nullable=False, default="0")
    rev_date = Column(Date)
    file_url = Column(String(500))
    is_current = Column(Integer, default=1)
    uploaded_by = Column(Integer, ForeignKey("users.id"))
    uploaded_at = Column(TIMESTAMP)
    notes = Column(Text)


class PartDocumentHistory(Base):
    __tablename__ = "part_document_history"
    id = Column(Integer, primary_key=True, index=True)
    part_id = Column(Integer, ForeignKey("parts.id"), nullable=False)
    doc_type = Column(String(100), nullable=False)
    doc_label = Column(String(150))
    revision = Column(String(20), nullable=False)
    rev_date = Column(Date)
    file_url = Column(String(500), nullable=False)
    archived_at = Column(TIMESTAMP)
    archived_by = Column(Integer, ForeignKey("users.id"))
    superseded_by = Column(Integer, ForeignKey("part_documents.id"))
    notes = Column(Text)


class PartQcParameter(Base):
    __tablename__ = "part_qc_parameters"
    id = Column(Integer, primary_key=True, index=True)
    part_id = Column(Integer, ForeignKey("parts.id"), nullable=False)
    seq_no = Column(Integer, nullable=False, default=1)
    parameter = Column(String(100), nullable=False)
    std_value = Column(String(100))
    method = Column(String(50))
    frequency = Column(String(50))
    is_numeric = Column(Integer, default=0)
    lsl = Column(Float, nullable=True)
    usl = Column(Float, nullable=True)
    extra_columns_json = Column(Text)
    active = Column(Integer, default=1)
    created_at = Column(TIMESTAMP)


class QcInspectionReport(Base):
    __tablename__ = "qc_inspection_reports"
    id = Column(Integer, primary_key=True, index=True)
    part_id = Column(Integer, ForeignKey("parts.id"))
    machine_id = Column(Integer, ForeignKey("machines.id"))
    article_no = Column(String(100))
    machine_name = Column(String(100))
    description = Column(String(255))
    operation_code = Column(String(50))
    operation_name = Column(String(100))
    production_section = Column(String(100))
    shift = Column(String(1))
    inspection_date = Column(Date, nullable=False)
    readings_json = Column(Text)
    operator_name = Column(String(100))
    inspector_name = Column(String(100))
    production_incharge = Column(String(100))
    approval_json = Column(Text)
    status = Column(String(30), default="draft")
    operator_id = Column(Integer, ForeignKey("users.id"))
    inspector_id = Column(Integer, ForeignKey("users.id"))
    incharge_id = Column(Integer, ForeignKey("users.id"))
    operator_approved_at = Column(DateTime)
    inspector_approved_at = Column(DateTime)
    incharge_approved_at = Column(DateTime)
    submitted_by = Column(Integer, ForeignKey("users.id"))
    submitted_at = Column(TIMESTAMP)


class MachineKpiLog(Base):
    """Snapshot of machine KPI metrics for historic analysis."""
    __tablename__ = "machine_kpi_log"
    id = Column(Integer, primary_key=True, index=True)
    machine_id = Column(Integer, ForeignKey("machines.id"), nullable=False)
    entry_date = Column(Date, nullable=False)
    shift = Column(String(1), nullable=False)
    model_variant = Column(String(100))
    available_time_min = Column(Float)
    operating_time_min = Column(Float)
    downtime_min = Column(Float)
    actual_production_time_min = Column(Float)
    cycle_time_sec = Column(Float)
    planned_qty = Column(Integer)
    actual_qty = Column(Integer)
    good_qty = Column(Integer)
    defect_qty = Column(Integer)
    expected_qty = Column(Integer)
    theoretical_qty = Column(Integer)
    ar = Column(Float)
    pr = Column(Float)
    qr = Column(Float)
    oee = Column(Float)
    machine_utilization = Column(Float)
    production_yield = Column(Float)
    teep = Column(Float)
    computed_at = Column(DateTime, nullable=False)
    source = Column(String(20), default="auto")
