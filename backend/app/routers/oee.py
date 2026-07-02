from fastapi import APIRouter, Depends, Query, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import extract, or_
from typing import Optional
from datetime import date, datetime
import csv, io
from ..models import OEEEntry, OEEDefectLog, get_db, now_ist
from ..auth import get_current_user
from pydantic import BaseModel

router = APIRouter(prefix="/api/oee", tags=["oee"])

class OEECreate(BaseModel):
    entry_date: date
    station_no: int
    machine_id: Optional[int] = None
    shift: str
    current_operation: Optional[str] = ""
    next_operation: Optional[str] = ""
    model_variant: Optional[str] = None
    process_time: float
    loading_unloading: float
    start_time: str
    stop_time: str
    total_minutes: int
    lunch_break: int = 0
    tea_break: int = 0
    tpm_cleaning: int = 0
    other_cleaning: int = 0
    management_meeting: int = 0
    no_load: int = 0
    new_model_trial: int = 0
    power_cut: int = 0
    planned_maintenance: int = 0
    no_manpower_planned: int = 0
    setting_time: int = 0
    tool_change: int = 0
    dimension_correction: int = 0
    scrap_removal: int = 0
    break_down: int = 0
    actual_qty: int
    defect_qty: int = 0

def calculate_oee(data: OEECreate) -> dict:
    # CT = Process Time + Loading & Unloading (seconds)
    ct = data.process_time + data.loading_unloading

    # Shift Working Min = Total Minutes - Total Breaks
    total_breaks = data.lunch_break + data.tea_break + data.tpm_cleaning + data.other_cleaning + data.management_meeting
    shift_working = data.total_minutes - total_breaks

    # Available Shift Time = Shift Working Min - Mgmt Loss Total
    mgmt_loss = data.no_load + data.new_model_trial + data.power_cut + data.planned_maintenance + data.no_manpower_planned
    available = shift_working - mgmt_loss

    # Operating Time = Available Shift Time - Total Down Time
    total_down = data.setting_time + data.tool_change + data.dimension_correction + data.scrap_removal + data.break_down
    operating = available - total_down

    # Possible Qty = (Operating Time * 60) / CT  [operating in min, CT in sec]
    possible_qty = int((operating * 60) / ct) if ct > 0 else 0

    # Production Loss = Possible Qty - Actual Qty
    production_loss = max(0, possible_qty - data.actual_qty)

    # Accepted Qty = Actual Qty - Defect Qty
    accp_qty = max(0, data.actual_qty - data.defect_qty)

    # AR = Operating Time / Available Shift Time
    ar = round((operating / available * 100), 2) if available > 0 else 0

    # PR = Actual Qty / Possible Qty
    pr = round((data.actual_qty / possible_qty * 100), 2) if possible_qty > 0 else 0

    # QR = Accepted Qty / Actual Qty
    qr = round((accp_qty / data.actual_qty * 100), 2) if data.actual_qty > 0 else 0

    # OEE = AR * PR * QR
    oee = round(ar * pr * qr / 10000, 2)

    return {
        # Only writable computed columns — generated columns (cycle_time, total_breaks,
        # shift_working_minutes, management_loss_total, total_down_time, production_loss)
        # are STORED GENERATED in MySQL and must NOT be written by the application.
        "available_shift_time": available,
        "operating_time": operating,
        "possible_qty": possible_qty,
        "accp_qty": accp_qty,
        "ar": ar, "pr": pr, "qr": qr, "oee": oee,
    }

@router.post("/")
def create_entry(data: OEECreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    from ..models import ProductionPlan
    calc = calculate_oee(data)
    entry = OEEEntry(**data.model_dump(), **calc, created_by=user.id)
    db.add(entry)
    db.flush()

    # Sync actual_qty to matching production plan
    plan = db.query(ProductionPlan).filter(
        ProductionPlan.plan_date == data.entry_date,
        ProductionPlan.shift == data.shift,
        ProductionPlan.station_no == data.station_no,
        ProductionPlan.current_operation == data.current_operation,
        ProductionPlan.next_operation == data.next_operation,
    ).first()
    if plan:
        plan.actual_qty = data.actual_qty
        if data.actual_qty >= plan.planned_qty and plan.status in ("pending", "running"):
            plan.status = "completed"

    db.commit()
    db.refresh(entry)
    return entry

@router.get("/")
def get_entries(
    shift: Optional[str] = None,
    entry_date: Optional[date] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    month: Optional[int] = None,
    year: Optional[int] = None,
    station_no: Optional[int] = None,
    machine_id: Optional[int] = None,
    current_operation: Optional[str] = None,
    model: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    _=Depends(get_current_user)
):
    q = db.query(OEEEntry)
    if shift: q = q.filter(OEEEntry.shift == shift)
    if entry_date: q = q.filter(OEEEntry.entry_date == entry_date)
    if date_from: q = q.filter(OEEEntry.entry_date >= date_from)
    if date_to: q = q.filter(OEEEntry.entry_date <= date_to)
    if month: q = q.filter(extract("month", OEEEntry.entry_date) == month)
    if year: q = q.filter(extract("year", OEEEntry.entry_date) == year)
    if station_no: q = q.filter(OEEEntry.station_no == station_no)
    if machine_id: q = q.filter(OEEEntry.machine_id == machine_id)
    term = (search or model or current_operation or "").strip()
    if term:
        like = f"%{term}%"
        q = q.filter(or_(
            OEEEntry.current_operation.like(like),
            OEEEntry.model_variant.like(like),
        ))
    return q.order_by(OEEEntry.entry_date.desc(), OEEEntry.shift).all()

@router.get("/summary")
def get_summary(
    shift: Optional[str] = None,
    entry_date: Optional[date] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    month: Optional[int] = None,
    year: Optional[int] = None,
    station_no: Optional[int] = None,
    machine_id: Optional[int] = None,
    current_operation: Optional[str] = None,
    model: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    _=Depends(get_current_user)
):
    from sqlalchemy import func
    q = db.query(OEEEntry)
    if shift: q = q.filter(OEEEntry.shift == shift)
    if entry_date: q = q.filter(OEEEntry.entry_date == entry_date)
    if date_from: q = q.filter(OEEEntry.entry_date >= date_from)
    if date_to: q = q.filter(OEEEntry.entry_date <= date_to)
    if month: q = q.filter(extract("month", OEEEntry.entry_date) == month)
    if year: q = q.filter(extract("year", OEEEntry.entry_date) == year)
    if station_no: q = q.filter(OEEEntry.station_no == station_no)
    if machine_id: q = q.filter(OEEEntry.machine_id == machine_id)
    term = (search or model or current_operation or "").strip()
    if term:
        like = f"%{term}%"
        q = q.filter(or_(
            OEEEntry.current_operation.like(like),
            OEEEntry.model_variant.like(like),
        ))
    entries = q.all()
    if not entries:
        return {"avg_ar": 0, "avg_pr": 0, "avg_qr": 0, "avg_oee": 0, "total_actual": 0, "total_accp": 0, "total_defect": 0}
    return {
        "avg_ar": round(sum(float(e.ar or 0) for e in entries) / len(entries), 2),
        "avg_pr": round(sum(float(e.pr or 0) for e in entries) / len(entries), 2),
        "avg_qr": round(sum(float(e.qr or 0) for e in entries) / len(entries), 2),
        "avg_oee": round(sum(float(e.oee or 0) for e in entries) / len(entries), 2),
        "total_actual": sum(e.actual_qty or 0 for e in entries),
        "total_accp": sum(e.accp_qty or 0 for e in entries),
        "total_defect": sum(e.defect_qty or 0 for e in entries),
        "count": len(entries)
    }

class DefectUpdate(BaseModel):
    defect_qty: int
    note: Optional[str] = ""

@router.patch("/{entry_id}/defect")
def update_defect(entry_id: int, data: DefectUpdate,
                  db: Session = Depends(get_db),
                  user=Depends(get_current_user)):
    entry = db.query(OEEEntry).filter(OEEEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(404, "Entry not found")

    # snapshot before
    before_defect = entry.defect_qty or 0
    before_accp   = entry.accp_qty   or 0
    before_qr     = float(entry.qr   or 0)
    before_oee    = float(entry.oee   or 0)

    # recalculate with new defect_qty
    actual = entry.actual_qty or 0
    new_defect = max(0, data.defect_qty)
    new_accp   = max(0, actual - new_defect)
    new_qr     = round(new_accp / actual * 100, 2) if actual > 0 else 0
    ar         = float(entry.ar or 0)
    pr         = float(entry.pr or 0)
    new_oee    = round(ar * pr * new_qr / 10000, 2)

    # write log
    log = OEEDefectLog(
        oee_entry_id    = entry_id,
        updated_at      = now_ist(),
        updated_by      = user.id,
        before_defect_qty = before_defect,
        before_accp_qty   = before_accp,
        before_qr         = before_qr,
        before_oee        = before_oee,
        after_defect_qty  = new_defect,
        after_accp_qty    = new_accp,
        after_qr          = new_qr,
        after_oee         = new_oee,
        note              = data.note or "",
    )
    db.add(log)

    # update entry
    entry.defect_qty = new_defect
    entry.accp_qty   = new_accp
    entry.qr         = new_qr
    entry.oee        = new_oee
    db.commit()
    db.refresh(entry)
    return {
        "id": entry_id,
        "defect_qty": new_defect, "accp_qty": new_accp,
        "qr": new_qr, "oee": new_oee,
        "before": {"defect_qty": before_defect, "accp_qty": before_accp,
                   "qr": before_qr, "oee": before_oee}
    }

@router.get("/{entry_id}/defect-log")
def get_defect_log(entry_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    from ..models import User
    logs = db.query(OEEDefectLog).filter(OEEDefectLog.oee_entry_id == entry_id)\
              .order_by(OEEDefectLog.updated_at.desc()).all()
    user_map = {u.id: u.username for u in db.query(User).all()}
    return [{
        "id": l.id,
        "updated_at": l.updated_at.strftime('%Y-%m-%d %H:%M:%S IST'),
        "updated_by": user_map.get(l.updated_by, str(l.updated_by)),
        "before_defect_qty": l.before_defect_qty, "before_accp_qty": l.before_accp_qty,
        "before_qr": float(l.before_qr or 0), "before_oee": float(l.before_oee or 0),
        "after_defect_qty": l.after_defect_qty, "after_accp_qty": l.after_accp_qty,
        "after_qr": float(l.after_qr or 0), "after_oee": float(l.after_oee or 0),
        "note": l.note or ""
    } for l in logs]

@router.get("/download-xlsx")
def download_xlsx(
    shift: Optional[str] = None,
    entry_date: Optional[date] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    month: Optional[int] = None,
    year: Optional[int] = None,
    station_no: Optional[int] = None,
    machine_id: Optional[int] = None,
    current_operation: Optional[str] = None,
    model: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    _=Depends(get_current_user)
):
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment
    from fastapi.responses import Response
    from ..models import Station, OEEDefectLog, User

    q = db.query(OEEEntry)
    if shift:      q = q.filter(OEEEntry.shift == shift)
    if entry_date: q = q.filter(OEEEntry.entry_date == entry_date)
    if date_from:  q = q.filter(OEEEntry.entry_date >= date_from)
    if date_to:    q = q.filter(OEEEntry.entry_date <= date_to)
    if month:      q = q.filter(extract("month", OEEEntry.entry_date) == month)
    if year:       q = q.filter(extract("year",  OEEEntry.entry_date) == year)
    if station_no:    q = q.filter(OEEEntry.station_no == station_no)
    if machine_id:  q = q.filter(OEEEntry.machine_id == machine_id)
    term = (search or model or current_operation or "").strip()
    if term:
        like = f"%{term}%"
        q = q.filter(or_(
            OEEEntry.current_operation.like(like),
            OEEEntry.model_variant.like(like),
        ))
    entries = q.order_by(OEEEntry.entry_date.desc(), OEEEntry.shift).all()

    from ..models import Machine
    station_map = {p.id: (p.display_name or p.name) for p in db.query(Station).all()}
    machine_map = {m.id: m.name for m in db.query(Machine).all()}
    user_map = {u.id: u.username for u in db.query(User).all()}

    def fmt_ist(dt_val):
        if not dt_val: return ''
        return dt_val.strftime('%d-%m-%Y %H:%M:%S IST')

    wb = openpyxl.Workbook()
    hdr_fill = PatternFill("solid", fgColor="1E3A5F")
    hdr_font = Font(bold=True, color="FFFFFF")
    red_f = Font(bold=True, color="DC2626")
    grn_f = Font(bold=True, color="059669")
    amb_f = Font(bold=True, color="D97706")

    def make_header(ws, hdrs):
        ws.append(hdrs)
        for c in range(1, len(hdrs)+1):
            cell = ws.cell(1, c)
            cell.fill = hdr_fill; cell.font = hdr_font
            cell.alignment = Alignment(horizontal="center")
        ws.freeze_panes = "A2"
        ws.auto_filter.ref = ws.dimensions

    # ── OEE sheet ──
    ws_oee = wb.active
    ws_oee.title = "OEE Report"
    oee_hdrs = ["Date","Station","Machine","Shift","Model / Variant","Current Operation","Next Operation","CT (sec)",
                "Avail (min)","Op Time (min)","Possible Qty","Actual Qty",
                "Prod Loss","Accepted Qty","Defect Qty","AR%","PR%","QR%","OEE%"]
    make_header(ws_oee, oee_hdrs)
    for e in entries:
        ct = (e.process_time or 0) + (e.loading_unloading or 0)
        prod_loss = max(0, (e.possible_qty or 0) - (e.actual_qty or 0))
        ws_oee.append([
            str(e.entry_date), station_map.get(e.station_no, str(e.station_no)),
            machine_map.get(e.machine_id, "") if e.machine_id else "",
            e.shift, e.model_variant or "",
            e.current_operation, e.next_operation,
            ct, e.available_shift_time, e.operating_time,
            e.possible_qty, e.actual_qty, prod_loss,
            e.accp_qty, e.defect_qty,
            float(e.ar or 0), float(e.pr or 0), float(e.qr or 0), float(e.oee or 0),
        ])
        oee_val = float(e.oee or 0)
        ws_oee.cell(ws_oee.max_row, 19).font = grn_f if oee_val>=85 else (amb_f if oee_val>=65 else red_f)
    for i, w in enumerate([12,14,10,8,16,14,14,10,12,14,12,12,10,12,12,8,8,8,8], 1):
        ws_oee.column_dimensions[ws_oee.cell(1,i).column_letter].width = w

    # ── QC Logs sheet ──
    entry_ids = [e.id for e in entries]
    qc_logs = []
    if entry_ids:
        qc_logs = db.query(OEEDefectLog)\
                    .filter(OEEDefectLog.oee_entry_id.in_(entry_ids))\
                    .order_by(OEEDefectLog.updated_at.desc()).all()
    entry_map = {e.id: e for e in entries}

    ws_qc = wb.create_sheet("QC Logs")
    qc_hdrs = [
        "Current Operation","Next Operation","Entry Date","Shift","Station",
        "Updated At (IST)","Updated By",
        "Before Defect","Before Accp","Before QR%","Before OEE%",
        "After Defect", "After Accp", "After QR%", "After OEE%",
        "Note"
    ]
    make_header(ws_qc, qc_hdrs)

    if not qc_logs:
        ws_qc.append(["No QC updates found for the selected filters."])
    else:
        for l in qc_logs:
            e = entry_map.get(l.oee_entry_id)
            before_oee = float(l.before_oee or 0)
            after_oee  = float(l.after_oee  or 0)
            ws_qc.append([
                e.current_operation if e else "", e.next_operation if e else "",
                str(e.entry_date) if e else "", e.shift if e else "",
                station_map.get(e.station_no, str(e.station_no)) if e else "",
                fmt_ist(l.updated_at),
                user_map.get(l.updated_by, str(l.updated_by) if l.updated_by else ""),
                l.before_defect_qty, l.before_accp_qty,
                f"{float(l.before_qr or 0):.2f}%", f"{before_oee:.2f}%",
                l.after_defect_qty,  l.after_accp_qty,
                f"{float(l.after_qr  or 0):.2f}%", f"{after_oee:.2f}%",
                l.note or "",
            ])
            ri = ws_qc.max_row
            bf = ws_qc.cell(ri, 11)
            bf.font = grn_f if before_oee>=85 else (amb_f if before_oee>=65 else red_f)
            af = ws_qc.cell(ri, 15)
            af.font = grn_f if after_oee>=85  else (amb_f if after_oee>=65  else red_f)

    for i, w in enumerate([18,18,12,8,14,22,14,14,12,12,12,12,12,12,12,35], 1):
        ws_qc.column_dimensions[ws_qc.cell(1,i).column_letter].width = w

    # ── OEE Daywise sheet ──
    from collections import defaultdict
    day_groups = defaultdict(list)
    for e in entries:
        day_groups[(str(e.entry_date), e.station_no)].append(e)

    ws_day = wb.create_sheet("OEE Daywise")
    day_hdrs = ["Date","Station","AR%","PR%","QR%","OEE%","Total Produced","Accepted Qty","Defects"]
    make_header(ws_day, day_hdrs)
    for (dt, pno), grp in sorted(day_groups.items()):
        n = len(grp)
        avg_ar  = round(sum(float(e.ar  or 0) for e in grp) / n, 2)
        avg_pr  = round(sum(float(e.pr  or 0) for e in grp) / n, 2)
        avg_qr  = round(sum(float(e.qr  or 0) for e in grp) / n, 2)
        avg_oee = round(sum(float(e.oee or 0) for e in grp) / n, 2)
        tot_act  = sum(e.actual_qty  or 0 for e in grp)
        tot_accp = sum(e.accp_qty    or 0 for e in grp)
        tot_def  = sum(e.defect_qty  or 0 for e in grp)
        ws_day.append([dt, station_map.get(pno, str(pno)),
                       avg_ar, avg_pr, avg_qr, avg_oee,
                       tot_act, tot_accp, tot_def])
        ri = ws_day.max_row
        ws_day.cell(ri, 6).font = grn_f if avg_oee >= 85 else (amb_f if avg_oee >= 65 else red_f)
    for i, w in enumerate([12,14,8,8,8,8,14,14,10], 1):
        ws_day.column_dimensions[ws_day.cell(1,i).column_letter].width = w

    # ── OEE Shiftwise sheet ──
    shift_groups = defaultdict(list)
    for e in entries:
        shift_groups[(str(e.entry_date), e.station_no, e.shift)].append(e)

    ws_shift = wb.create_sheet("OEE Shiftwise")
    shift_hdrs = ["Date","Station","Shift","Actual","Prod Loss","Accepted","Defects","AR%","PR%","QR%","OEE%"]
    make_header(ws_shift, shift_hdrs)
    for (dt, pno, sh), grp in sorted(shift_groups.items()):
        n = len(grp)
        tot_act  = sum(e.actual_qty  or 0 for e in grp)
        tot_loss = sum(max(0, (e.possible_qty or 0) - (e.actual_qty or 0)) for e in grp)
        tot_accp = sum(e.accp_qty    or 0 for e in grp)
        tot_def  = sum(e.defect_qty  or 0 for e in grp)
        avg_ar   = round(sum(float(e.ar  or 0) for e in grp) / n, 2)
        avg_pr   = round(sum(float(e.pr  or 0) for e in grp) / n, 2)
        avg_qr   = round(sum(float(e.qr  or 0) for e in grp) / n, 2)
        avg_oee  = round(sum(float(e.oee or 0) for e in grp) / n, 2)
        ws_shift.append([dt, station_map.get(pno, str(pno)), sh,
                         tot_act, tot_loss, tot_accp, tot_def,
                         avg_ar, avg_pr, avg_qr, avg_oee])
        ri = ws_shift.max_row
        ws_shift.cell(ri, 11).font = grn_f if avg_oee >= 85 else (amb_f if avg_oee >= 65 else red_f)
    for i, w in enumerate([12,14,8,10,10,12,10,8,8,8,8], 1):
        ws_shift.column_dimensions[ws_shift.cell(1,i).column_letter].width = w

    buf = io.BytesIO()
    wb.save(buf)
    label = str(entry_date or date_from or month or "report")
    return Response(
        content=buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="oee_report_{label}.xlsx"'}
    )


@router.get("/download")
def download_csv(
    shift: Optional[str] = None,
    entry_date: Optional[date] = None,
    month: Optional[int] = None,
    year: Optional[int] = None,
    station_no: Optional[int] = None,
    db: Session = Depends(get_db),
    _=Depends(get_current_user)
):
    q = db.query(OEEEntry)
    if shift: q = q.filter(OEEEntry.shift == shift)
    if entry_date: q = q.filter(OEEEntry.entry_date == entry_date)
    if month: q = q.filter(extract("month", OEEEntry.entry_date) == month)
    if year: q = q.filter(extract("year", OEEEntry.entry_date) == year)
    if station_no: q = q.filter(OEEEntry.station_no == station_no)
    entries = q.order_by(OEEEntry.entry_date, OEEEntry.shift).all()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Date","Station","Shift","Model / Variant","Current Operation","Next Operation","CT","Start","Stop","Total Min",
                     "Lunch","Tea","TPM","Other Clean","Mgmt Mtg","No Load","New Model","Power Cut",
                     "Planned Maint","No Manpower","Avail Time","Setting","Tool Change","Dim Corr",
                     "Scrap","Breakdown","Operating Time","Possible Qty","Actual Qty","Accp Qty",
                     "Defect Qty","AR%","PR%","QR%","OEE%"])
    for e in entries:
        writer.writerow([e.entry_date, e.station_no, e.shift, e.model_variant or "", e.current_operation, e.next_operation,
                         (e.process_time or 0)+(e.loading_unloading or 0), e.start_time, e.stop_time,
                         e.total_minutes, e.lunch_break, e.tea_break, e.tpm_cleaning, e.other_cleaning,
                         e.management_meeting, e.no_load, e.new_model_trial, e.power_cut,
                         e.planned_maintenance, e.no_manpower_planned, e.available_shift_time,
                         e.setting_time, e.tool_change, e.dimension_correction, e.scrap_removal,
                         e.break_down, e.operating_time, e.possible_qty, e.actual_qty, e.accp_qty,
                         e.defect_qty, e.ar, e.pr, e.qr, e.oee])
    output.seek(0)
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=oee_report.csv"})
