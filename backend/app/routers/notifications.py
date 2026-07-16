"""In-app notification feed for header bell (alerts, approvals, warnings)."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
import json
import pytz

from ..models import (
    ModelChangeRequest, Machine, ProductionPlan, BreakdownTicket,
    QcInspectionReport, get_db,
)
from ..auth import get_current_user

IST = pytz.timezone("Asia/Kolkata")

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


def _now():
    return datetime.now(IST).replace(tzinfo=None)


def _iso(val):
    if val is None:
        return None
    if hasattr(val, "isoformat"):
        return val.isoformat()
    return str(val)


@router.get("/")
def list_notifications(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Aggregate actionable alerts for the current user."""
    items = []
    role = getattr(user, "role", None) or ""

    # Pending model-change approvals (planning interlock + manual)
    pending_mcr = (
        db.query(ModelChangeRequest)
        .filter(ModelChangeRequest.status == "pending")
        .order_by(ModelChangeRequest.created_at.desc())
        .limit(50)
        .all()
    )
    for mcr in pending_mcr:
        machine = db.query(Machine).filter(Machine.id == mcr.machine_id).first()
        mname = machine.name if machine else f"Machine #{mcr.machine_id}"
        source = "Planning" if mcr.plan_id else "Manual"
        needs_action = role in ("supervisor", "admin")
        items.append({
            "id": f"mcr-pending-{mcr.id}",
            "kind": "model_change",
            "severity": "warning" if needs_action else "info",
            "title": "Model change approval required" if needs_action else "Model change awaiting approval",
            "body": f"{mcr.from_model} → {mcr.to_model} on {mname} ({source}"
                    + (f", plan #{mcr.plan_id}" if mcr.plan_id else "")
                    + ")",
            "path": "/model-change",
            "created_at": _iso(mcr.created_at),
            "meta": {"mcr_id": mcr.id, "plan_id": mcr.plan_id, "machine_id": mcr.machine_id},
        })

    # Active model change (setting change in progress)
    active_mcr = (
        db.query(ModelChangeRequest)
        .filter(ModelChangeRequest.status.in_(["approved", "in_progress"]))
        .order_by(ModelChangeRequest.start_time.desc())
        .limit(30)
        .all()
    )
    for mcr in active_mcr:
        machine = db.query(Machine).filter(Machine.id == mcr.machine_id).first()
        mname = machine.name if machine else f"Machine #{mcr.machine_id}"
        elapsed = 0
        if mcr.start_time:
            elapsed = max(0, int((_now() - mcr.start_time).total_seconds() / 60))
        over = elapsed > (mcr.ideal_minutes or 60)
        items.append({
            "id": f"mcr-active-{mcr.id}",
            "kind": "setting_change",
            "severity": "alert" if over else "info",
            "title": "Setting change in progress" + (" — exceeded ideal time" if over else ""),
            "body": f"{mname}: {mcr.from_model} → {mcr.to_model} · {elapsed} min"
                    + (f" / ideal {mcr.ideal_minutes} min" if mcr.ideal_minutes else ""),
            "path": "/model-change",
            "created_at": _iso(mcr.start_time or mcr.created_at),
            "meta": {"mcr_id": mcr.id, "elapsed_minutes": elapsed},
        })

    # Open breakdown tickets
    tickets = (
        db.query(BreakdownTicket)
        .filter(BreakdownTicket.status.in_(["raised", "acknowledged", "in_progress"]))
        .order_by(BreakdownTicket.id.desc())
        .limit(40)
        .all()
    )
    for tk in tickets:
        machine = db.query(Machine).filter(Machine.id == tk.machine_id).first()
        mname = machine.name if machine else f"Machine #{tk.machine_id}"
        sev = "alert" if tk.status == "raised" else "warning"
        items.append({
            "id": f"bd-{tk.id}",
            "kind": "breakdown",
            "severity": sev,
            "title": f"Breakdown #{tk.id} — {tk.status}",
            "body": f"{mname}: {(tk.description or 'No description')[:120]}",
            "path": "/breakdown",
            "created_at": _iso(tk.created_at),
            "meta": {"ticket_id": tk.id, "machine_id": tk.machine_id},
        })

    # Plans waiting on model-change approval
    pending_plan_ids = [
        mcr.plan_id for mcr in pending_mcr if mcr.plan_id
    ]
    if pending_plan_ids:
        plans = (
            db.query(ProductionPlan)
            .filter(
                ProductionPlan.id.in_(pending_plan_ids),
                ProductionPlan.status == "pending",
            )
            .all()
        )
        for plan in plans:
            items.append({
                "id": f"plan-await-{plan.id}",
                "kind": "planning",
                "severity": "warning",
                "title": f"Plan #{plan.id} awaiting model change",
                "body": f"{plan.model_variant or plan.current_operation} · shift {plan.shift} · {plan.plan_date}",
                "path": "/planning",
                "created_at": _iso(plan.updated_at or plan.created_at),
                "meta": {"plan_id": plan.id},
            })

    # Sort newest first
    items.sort(key=lambda x: x.get("created_at") or "", reverse=True)

    # SPC alerts from recent QC inspection reports (last 24h)
    cutoff = _now() - timedelta(hours=24)
    recent_reports = (
        db.query(QcInspectionReport)
        .filter(QcInspectionReport.submitted_at >= cutoff)
        .order_by(QcInspectionReport.submitted_at.desc())
        .limit(30)
        .all()
    )
    for report in recent_reports:
        try:
            from ..routers.qc_inspection import _spc_warnings_for_report
            out = {
                "part_id": report.part_id,
                "article_no": report.article_no,
                "readings": json.loads(report.readings_json or "[]"),
            }
            warnings = _spc_warnings_for_report(out, db)
            if not warnings:
                continue
            body = "; ".join(
                f"{w.get('parameter', '')}: {w.get('message', '')}" for w in warnings[:3]
            ) + (f" (+{len(warnings)-3} more)" if len(warnings) > 3 else "")
            items.append({
                "id": f"spc-{report.id}",
                "kind": "spc_alert",
                "severity": "alert",
                "title": f"SPC Alert — {report.article_no or 'QC Report'} (Shift {report.shift})",
                "body": body,
                "path": "/qc-approvals",
                "created_at": _iso(report.submitted_at),
                "meta": {
                    "report_id": report.id,
                    "warning_count": len(warnings),
                },
            })
        except Exception:
            continue

    # Re-sort after adding SPC items
    items.sort(key=lambda x: x.get("created_at") or "", reverse=True)

    return {
        "items": items,
        "count": len(items),
        "unread": len([i for i in items if i["severity"] in ("alert", "warning")]),
    }
