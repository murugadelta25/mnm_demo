from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import extract, func
from datetime import date, datetime
from typing import Optional, List
from pydantic import BaseModel
import io, smtplib, os
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email.mime.text import MIMEText
from email import encoders
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment
from ..models import ProductionPlan, Machine, ModelChangeRequest, EmailLog, get_db, now_ist
from ..auth import get_current_user, require_role
from ..ws_manager import manager

router = APIRouter(prefix="/api/plans", tags=["plans"])

class PlanCreate(BaseModel):
    plan_date: date
    end_date: Optional[date] = None   # if set, creates plans for each day in range
    shift: str
    station_no: int
    machine_id: Optional[int] = None
    current_operation: str
    next_operation: str
    model_variant: Optional[str] = None
    process_time: float
    loading_unloading: float = 10
    planned_qty: int
    priority: int = 1
    plan_type: str = "scheduled"
    notes: Optional[str] = None

class PlanUpdate(BaseModel):
    planned_qty: Optional[int] = None
    priority: Optional[int] = None
    plan_type: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[str] = None

class ActualQtyUpdate(BaseModel):
    actual_qty: int
    source: str = "manual"  # manual | modbus | opcua | mqtt

@router.post("/")
async def create_plan(data: PlanCreate, db: Session = Depends(get_db),
                      user=Depends(get_current_user)):
    from datetime import timedelta
    start = data.plan_date
    end   = data.end_date if data.end_date and data.end_date >= start else start
    delta = (end - start).days + 1
    created = []
    base = data.model_dump(exclude={"end_date"})
    for i in range(delta):
        day_data = {**base, "plan_date": start + timedelta(days=i)}
        plan = ProductionPlan(**day_data, created_by=user.id, created_at=now_ist())
        db.add(plan)
        db.flush()
        created.append(plan)
    db.commit()
    for plan in created:
        db.refresh(plan)
        await manager.broadcast({"type": "plan_created", "plan_id": plan.id,
                                  "station_no": plan.station_no, "shift": plan.shift,
                                  "current_operation": plan.current_operation, "next_operation": plan.next_operation,
                                  "planned_qty": plan.planned_qty})
    return created if delta > 1 else created[0]

@router.get("/")
def get_plans(
    plan_date: Optional[date] = None,
    shift: Optional[str] = None,
    station_no: Optional[int] = None,
    week: Optional[int] = None,
    week_start: Optional[date] = None,
    week_end: Optional[date] = None,
    month: Optional[int] = None,
    year: Optional[int] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    _=Depends(get_current_user)
):
    q = db.query(ProductionPlan)
    if plan_date:  q = q.filter(ProductionPlan.plan_date == plan_date)
    if shift:      q = q.filter(ProductionPlan.shift == shift)
    if station_no:    q = q.filter(ProductionPlan.station_no == station_no)
    if month:      q = q.filter(extract("month", ProductionPlan.plan_date) == month)
    if year:       q = q.filter(extract("year",  ProductionPlan.plan_date) == year)
    if week:       q = q.filter(extract("week",  ProductionPlan.plan_date) == week)
    if week_start: q = q.filter(ProductionPlan.plan_date >= week_start)
    if week_end:   q = q.filter(ProductionPlan.plan_date <= week_end)
    if date_from:  q = q.filter(ProductionPlan.plan_date >= date_from)
    if date_to:    q = q.filter(ProductionPlan.plan_date <= date_to)
    if status:     q = q.filter(ProductionPlan.status == status)
    return q.order_by(ProductionPlan.plan_date, ProductionPlan.shift, ProductionPlan.priority).all()

@router.get("/summary")
def get_summary(
    plan_date: Optional[date] = None,
    shift: Optional[str] = None,
    station_no: Optional[int] = None,
    month: Optional[int] = None,
    year: Optional[int] = None,
    week_start: Optional[date] = None,
    week_end: Optional[date] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    db: Session = Depends(get_db),
    _=Depends(get_current_user)
):
    q = db.query(ProductionPlan)
    if plan_date:  q = q.filter(ProductionPlan.plan_date == plan_date)
    if shift:      q = q.filter(ProductionPlan.shift == shift)
    if station_no:    q = q.filter(ProductionPlan.station_no == station_no)
    if month:      q = q.filter(extract("month", ProductionPlan.plan_date) == month)
    if year:       q = q.filter(extract("year",  ProductionPlan.plan_date) == year)
    if week_start: q = q.filter(ProductionPlan.plan_date >= week_start)
    if week_end:   q = q.filter(ProductionPlan.plan_date <= week_end)
    if date_from:  q = q.filter(ProductionPlan.plan_date >= date_from)
    if date_to:    q = q.filter(ProductionPlan.plan_date <= date_to)
    plans = q.all()
    total_planned = sum(p.planned_qty for p in plans)
    total_actual  = sum(p.actual_qty  for p in plans)
    return {
        "total_plans": len(plans),
        "total_planned": total_planned,
        "total_actual": total_actual,
        "achievement_pct": round(total_actual / total_planned * 100, 1) if total_planned else 0,
        "by_status": {s: sum(1 for p in plans if p.status == s)
                      for s in ["pending","running","completed","paused","cancelled"]},
        "by_shift": {sh: {"planned": sum(p.planned_qty for p in plans if p.shift == sh),
                           "actual":  sum(p.actual_qty  for p in plans if p.shift == sh)}
                     for sh in ["A","B"]}
    }

@router.patch("/{plan_id}/status")
async def update_status(plan_id: int, data: PlanUpdate, db: Session = Depends(get_db),
                        user=Depends(get_current_user)):
    plan = db.query(ProductionPlan).filter(ProductionPlan.id == plan_id).first()
    if not plan: raise HTTPException(404, "Plan not found")
    if data.status: plan.status = data.status
    if data.planned_qty is not None: plan.planned_qty = data.planned_qty
    if data.priority is not None: plan.priority = data.priority
    if data.plan_type: plan.plan_type = data.plan_type
    if data.notes is not None: plan.notes = data.notes
    plan.updated_at = now_ist()

    # When plan goes running — auto-trigger model change check and update machine
    if data.status == "running":
        machine = db.query(Machine).filter(Machine.id == plan.machine_id).first()
        if machine and machine.status not in ("breakdown",):
            machine.status = "running"
        db.commit()
        await manager.broadcast({
            "type": "plan_started", "plan_id": plan_id,
            "machine_id": plan.machine_id, "station_no": plan.station_no,
            "current_operation": plan.current_operation, "next_operation": plan.next_operation,
            "process_time": plan.process_time, "loading_unloading": plan.loading_unloading,
            "shift": plan.shift, "plan_date": str(plan.plan_date)
        })
    elif data.status == "completed":
        machine = db.query(Machine).filter(Machine.id == plan.machine_id).first()
        if machine: machine.status = "idle"
        db.commit()
        await manager.broadcast({"type": "plan_completed", "plan_id": plan_id,
                                  "machine_id": plan.machine_id, "station_no": plan.station_no})
    else:
        db.commit()
        await manager.broadcast({"type": "plan_updated", "plan_id": plan_id, "status": data.status})
    return plan

@router.patch("/{plan_id}/actual")
async def update_actual_qty(plan_id: int, data: ActualQtyUpdate, db: Session = Depends(get_db),
                             _=Depends(get_current_user)):
    """Called by manual entry, MQTT bridge, Modbus bridge, or OPC-UA bridge"""
    plan = db.query(ProductionPlan).filter(ProductionPlan.id == plan_id).first()
    if not plan: raise HTTPException(404, "Plan not found")
    plan.actual_qty = data.actual_qty
    plan.updated_at = now_ist()
    if data.actual_qty >= plan.planned_qty and plan.status == "running":
        plan.status = "completed"
        machine = db.query(Machine).filter(Machine.id == plan.machine_id).first()
        if machine: machine.status = "idle"
    db.commit()
    await manager.broadcast({
        "type": "actual_qty_updated", "plan_id": plan_id,
        "actual_qty": data.actual_qty, "planned_qty": plan.planned_qty,
        "source": data.source, "station_no": plan.station_no
    })
    return plan

@router.delete("/{plan_id}")
async def delete_plan(plan_id: int, db: Session = Depends(get_db),
                      user=Depends(require_role("supervisor", "admin"))):
    plan = db.query(ProductionPlan).filter(ProductionPlan.id == plan_id).first()
    if not plan: raise HTTPException(404, "Plan not found")
    db.delete(plan)
    db.commit()
    await manager.broadcast({"type": "plan_deleted", "plan_id": plan_id})
    return {"ok": True}

@router.get("/pipeline/{station_no}")
def get_pipeline(station_no: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    """Returns ordered queue for a machine — next part to load is first"""
    plans = db.query(ProductionPlan).filter(
        ProductionPlan.station_no == station_no,
        ProductionPlan.status.in_(["pending", "running"])
    ).order_by(ProductionPlan.plan_date, ProductionPlan.shift, ProductionPlan.priority).all()
    return plans


def _style_header_row(ws, ncols):
    hdr_fill = PatternFill("solid", fgColor="1E3A5F")
    hdr_font = Font(bold=True, color="FFFFFF")
    for col in range(1, ncols + 1):
        cell = ws.cell(row=1, column=col)
        cell.fill = hdr_fill
        cell.font = hdr_font
        cell.alignment = Alignment(horizontal="center")

def _build_excel(plans) -> io.BytesIO:
    wb = openpyxl.Workbook()
    now = datetime.now()

    # ── Sheet 1: Summary ──────────────────────────────────────────────────────
    ws1 = wb.active
    ws1.title = "Summary"
    total_planned = sum(p.planned_qty for p in plans)
    total_actual  = sum(p.actual_qty  for p in plans)
    achievement   = round(total_actual / total_planned * 100, 1) if total_planned else 0
    by_status = {s: sum(1 for p in plans if p.status == s)
                 for s in ["pending", "running", "completed", "paused", "cancelled"]}
    summary_rows = [
        ["PRODUCTION PLANNING REPORT"],
        [""],
        ["Report Date:", now.strftime("%d-%m-%Y")],
        ["Period:", f"{plans[0].plan_date} to {plans[-1].plan_date}" if len(plans) > 1 else (str(plans[0].plan_date) if plans else "")],
        [""],
        ["SUMMARY METRICS"],
        ["Total Plans:",    len(plans)],
        ["Planned Quantity:", total_planned],
        ["Actual Quantity:",  total_actual],
        ["Achievement %:",    str(achievement) + "%"],
        [""],
        ["STATUS BREAKDOWN"],
        ["Pending:",   by_status["pending"]],
        ["Running:",   by_status["running"]],
        ["Completed:", by_status["completed"]],
        ["Paused:",    by_status["paused"]],
        ["Cancelled:", by_status["cancelled"]],
    ]
    for row in summary_rows:
        ws1.append(row)
    ws1.column_dimensions["A"].width = 22
    ws1.column_dimensions["B"].width = 18

    # ── Sheet 2: Plans Details ────────────────────────────────────────────────
    ws2 = wb.create_sheet("Plans Details")
    headers2 = ["Date","Shift","Station","Current Operation","Next Operation","Process Time (s)",
                "Loading/Unloading (s)","Cycle Time (s)","Type","Priority",
                "Planned Qty","Actual Qty","Achievement %","Status","Notes"]
    ws2.append(headers2)
    _style_header_row(ws2, len(headers2))
    for p in plans:
        pct = round(p.actual_qty / p.planned_qty * 100, 1) if p.planned_qty else 0
        ws2.append([str(p.plan_date), p.shift, getattr(p, '_station_label', p.station_no), p.current_operation, p.next_operation,
                    p.process_time, p.loading_unloading, p.process_time + p.loading_unloading,
                    p.plan_type, p.priority, p.planned_qty, p.actual_qty,
                    str(pct) + "%", p.status, p.notes or ""])
    col_widths2 = [12,8,6,14,14,16,20,14,12,10,12,12,14,12,20]
    for i, w in enumerate(col_widths2, 1):
        ws2.column_dimensions[ws2.cell(row=1, column=i).column_letter].width = w

    # ── Sheet 3: By Pair ──────────────────────────────────────────────────────
    ws3 = wb.create_sheet("By Station")
    headers3 = ["Station No","Total Plans","Planned Qty","Actual Qty",
                "Achievement %","Completed","Running","Pending"]
    ws3.append(headers3)
    _style_header_row(ws3, len(headers3))
    station_stats = {}
    for p in plans:
        key = getattr(p, '_station_label', str(p.station_no))
        ps = station_stats.setdefault(key, {"planned": 0, "actual": 0, "total": 0,
                                         "completed": 0, "running": 0, "pending": 0})
        ps["total"] += 1; ps["planned"] += p.planned_qty; ps["actual"] += p.actual_qty
        if p.status in ps: ps[p.status] += 1
    for pn, ps in sorted(station_stats.items(), key=lambda x: str(x[0])):
        pct = round(ps["actual"] / ps["planned"] * 100, 1) if ps["planned"] else 0
        ws3.append([pn, ps["total"], ps["planned"], ps["actual"],
                    str(pct) + "%", ps["completed"], ps["running"], ps["pending"]])
    for i, w in enumerate([10,12,12,12,14,12,12,12], 1):
        ws3.column_dimensions[ws3.cell(row=1, column=i).column_letter].width = w

    # ── Sheet 4: By Shift ─────────────────────────────────────────────────────
    ws4 = wb.create_sheet("By Shift")
    headers4 = ["Shift","Total Plans","Planned Qty","Actual Qty",
                "Achievement %","Completed","Running"]
    ws4.append(headers4)
    _style_header_row(ws4, len(headers4))
    shift_stats = {}
    for p in plans:
        ss = shift_stats.setdefault(p.shift, {"planned": 0, "actual": 0, "total": 0,
                                              "completed": 0, "running": 0})
        ss["total"] += 1; ss["planned"] += p.planned_qty; ss["actual"] += p.actual_qty
        if p.status in ss: ss[p.status] += 1
    for sh, ss in sorted(shift_stats.items()):
        pct = round(ss["actual"] / ss["planned"] * 100, 1) if ss["planned"] else 0
        ws4.append([sh, ss["total"], ss["planned"], ss["actual"],
                    str(pct) + "%", ss["completed"], ss["running"]])
    for i, w in enumerate([10,12,12,12,14,12,12], 1):
        ws4.column_dimensions[ws4.cell(row=1, column=i).column_letter].width = w

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf


class ExportParams(BaseModel):
    plan_date: Optional[str] = None
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    month: Optional[int] = None
    year: Optional[int] = None
    shift: Optional[str] = None
    station_no: Optional[int] = None


class EmailReportRequest(ExportParams):
    recipients: List[str]
    subject: Optional[str] = "Production Planning Report"


def _filter_plans(q, params: ExportParams):
    if params.plan_date: q = q.filter(ProductionPlan.plan_date == params.plan_date)
    if params.date_from: q = q.filter(ProductionPlan.plan_date >= params.date_from)
    if params.date_to:   q = q.filter(ProductionPlan.plan_date <= params.date_to)
    if params.shift:     q = q.filter(ProductionPlan.shift == params.shift)
    if params.station_no:   q = q.filter(ProductionPlan.station_no == params.station_no)
    if params.month:     q = q.filter(extract("month", ProductionPlan.plan_date) == params.month)
    if params.year:      q = q.filter(extract("year",  ProductionPlan.plan_date) == params.year)
    return q


@router.post("/export")
def export_excel(params: ExportParams, db: Session = Depends(get_db),
                 _=Depends(get_current_user)):
    q = _filter_plans(db.query(ProductionPlan), params)
    plans = q.order_by(ProductionPlan.plan_date, ProductionPlan.shift, ProductionPlan.priority).all()
    buf = _build_excel(plans)
    filename = f"production_plan_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
    return StreamingResponse(buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"})


@router.get("/email-logs")
def get_email_logs(db: Session = Depends(get_db), _=Depends(get_current_user)):
    logs = db.query(EmailLog).order_by(EmailLog.sent_at.desc()).limit(100).all()
    return [{"id": l.id, "sent_at": l.sent_at, "recipients": l.recipients,
             "subject": l.subject, "report_type": l.report_type,
             "status": l.status, "error_msg": l.error_msg} for l in logs]


@router.post("/email-report")
def email_report(req: EmailReportRequest, db: Session = Depends(get_db),
                 user=Depends(get_current_user)):
    q = _filter_plans(db.query(ProductionPlan), req)
    plans = q.order_by(ProductionPlan.plan_date, ProductionPlan.shift, ProductionPlan.priority).all()
    buf = _build_excel(plans)
    filename = f"production_plan_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"

    from ..models import EmailSmtpConfig
    cfg = db.query(EmailSmtpConfig).first()
    smtp_host = cfg.smtp_server if cfg else os.getenv("SMTP_HOST", "smtp.gmail.com")
    smtp_port = cfg.smtp_port   if cfg else int(os.getenv("SMTP_PORT", 587))
    smtp_user = cfg.email_address  if cfg else os.getenv("SMTP_USER", "")
    smtp_pass = cfg.email_password if cfg else os.getenv("SMTP_PASS", "")

    if not smtp_user or not smtp_pass:
        raise HTTPException(400, "SMTP credentials not configured")

    msg = MIMEMultipart()
    msg["From"]    = smtp_user
    msg["To"]      = ", ".join(req.recipients)
    msg["Subject"] = req.subject
    msg.attach(MIMEText(f"Please find attached the production planning report generated on {datetime.now().strftime('%d-%m-%Y %H:%M:%S')}.", "plain"))
    part = MIMEBase("application", "octet-stream")
    part.set_payload(buf.read())
    encoders.encode_base64(part)
    part.add_header("Content-Disposition", f"attachment; filename={filename}")
    msg.attach(part)

    log = EmailLog(sent_at=now_ist(), recipients=", ".join(req.recipients),
                   subject=req.subject, report_type="planning",
                   sent_by=user.id if user else None)
    try:
        with smtplib.SMTP(smtp_host, smtp_port) as server:
            server.starttls()
            server.login(smtp_user, smtp_pass)
            server.sendmail(smtp_user, req.recipients, msg.as_string())
        log.status = "sent"
    except Exception as e:
        log.status = "failed"
        log.error_msg = str(e)
        db.add(log)
        db.commit()
        raise HTTPException(500, f"Email send failed: {str(e)}")
    db.add(log)
    db.commit()
    return {"ok": True, "sent_to": req.recipients}
