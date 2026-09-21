"""Shared contract for machine-family process / setpoint email alerts."""
from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime
from typing import List, Optional

from sqlalchemy.orm import Session

from ..models import Machine


# Separate from classic OEE / loss-tracker / deviation_alerts report types
PROCESS_SETPOINT_REPORT_KEY = "process_setpoint_alerts"

_PARAM_LABELS = {
    "pressure": "Pressure",
    "flow": "Flow",
    "tank_level": "Tank Level",
    "temperature": "Temperature",
}


class ProcessAlertModule(ABC):
    """One module per machine family — loaded only when that profile is active."""

    module_id: str = "base"
    label: str = "Process Alerts"
    profile_ids: tuple = ()
    machine_type_hints: tuple = ()

    def matches(self, *, profile_id: str = "", machine_type: str = "", machine_name: str = "") -> bool:
        pid = (profile_id or "").strip().lower()
        mtype = (machine_type or "").strip().lower()
        if pid and pid in {p.lower() for p in self.profile_ids}:
            return True
        if mtype and any(h.lower() in mtype for h in self.machine_type_hints):
            return True
        return False

    @abstractmethod
    def describe(self) -> dict:
        """UI metadata: id, label, parameters, how setpoints work."""

    @abstractmethod
    def on_raised_events(
        self,
        db: Session,
        *,
        machine: Machine,
        raised_events: List[dict],
    ) -> Optional[dict]:
        """Send email for newly raised setpoint breaches. Return status dict for UI."""


def _fmt_limit(v) -> str:
    if v is None:
        return "—"
    try:
        return f"{float(v):g}"
    except (TypeError, ValueError):
        return str(v)


def _fmt_value(v) -> str:
    if v is None:
        return "—"
    try:
        return f"{float(v):g}"
    except (TypeError, ValueError):
        return str(v)


def _param_name(ev: dict) -> str:
    key = str(ev.get("tag_key") or "").strip().lower()
    if key in _PARAM_LABELS:
        return _PARAM_LABELS[key]
    raw = str(ev.get("label") or key or "Parameter")
    for sep in (" above ", " below "):
        if sep in raw:
            return raw.split(sep, 1)[0].strip()
    return raw


def _side_phrase(ev: dict) -> str:
    return "above USL" if ev.get("side") == "high" else "below LSL"


def format_breach_line(ev: dict) -> str:
    """Plain: Pressure above USL = 98 kPa (set USL = 90 kPa and LSL = 60 kPa)"""
    name = _param_name(ev)
    unit = (ev.get("unit") or "").strip()
    u = f" {unit}" if unit else ""
    val = _fmt_value(ev.get("value"))
    usl = _fmt_limit(ev.get("usl"))
    lsl = _fmt_limit(ev.get("lsl"))
    return (
        f"{name} {_side_phrase(ev)} = {val}{u} "
        f"(set USL = {usl}{u} and LSL = {lsl}{u})"
    )


def format_breach_line_html(ev: dict) -> str:
    """HTML: deviant value red, USL/LSL limits blue."""
    import html as html_lib
    name = html_lib.escape(_param_name(ev))
    unit = (ev.get("unit") or "").strip()
    u = f" {html_lib.escape(unit)}" if unit else ""
    val = html_lib.escape(_fmt_value(ev.get("value")))
    usl = html_lib.escape(_fmt_limit(ev.get("usl")))
    lsl = html_lib.escape(_fmt_limit(ev.get("lsl")))
    side = html_lib.escape(_side_phrase(ev))
    red = f'<span style="color:#dc2626;font-weight:700">{val}{u}</span>'
    blue_usl = f'<span style="color:#2563eb;font-weight:700">{usl}{u}</span>'
    blue_lsl = f'<span style="color:#2563eb;font-weight:700">{lsl}{u}</span>'
    return (
        f"{name} {side} = {red} "
        f"(set USL = {blue_usl} and LSL = {blue_lsl})"
    )


def enrich_machine_context(db: Session, machine: Machine) -> dict:
    """Line / station / equipment names for alarm subject + body."""
    from ..models import Station

    station_name = "—"
    line_name = "—"
    if machine and machine.station_id:
        st = db.query(Station).filter(Station.id == machine.station_id).first()
        if st:
            station_name = (st.display_name or st.name or "—").strip() or "—"
            line_name = (st.name or st.display_name or "—").strip() or "—"
    equipment = (machine.name if machine else None) or "—"
    if machine and getattr(machine, "location", None):
        loc = str(machine.location).strip()
        if loc:
            line_name = loc
    return {
        "equipment": equipment,
        "station": station_name,
        "line": line_name,
        "machine_type": getattr(machine, "machine_type", None) or "—",
    }


def build_setpoint_alarm_email(
    *,
    ctx: dict,
    raised_events: List[dict],
    deviation_time: Optional[datetime] = None,
) -> tuple[str, str, str]:
    """
    Returns (subject, plain_body, html_body).
    Event Message is multi-line; HTML highlights deviant (red) and limits (blue).
    """
    import html as html_lib
    from ..models import now_ist
    from ..deviation_alert_service import _fmt_ist

    events = [e for e in (raised_events or []) if isinstance(e, dict)]
    alarm_code = "—"
    if events:
        codes = [str(e.get("event_id") or e.get("code") or "").strip() for e in events]
        codes = [c for c in codes if c]
        alarm_code = codes[0] if codes else "—"

    line = ctx.get("line") or "—"
    station = ctx.get("station") or "—"
    equipment = ctx.get("equipment") or "—"
    subject = f"Alarm Alert - {alarm_code} | {line} | {station}"

    when = deviation_time or now_ist()
    try:
        deviation_str = when.strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        deviation_str = _fmt_ist(when)

    # Multi-line event message (plain)
    msg_lines = [
        f"Line [{line}]",
        f"Station [{station}]",
        f"Equipment [{equipment}]",
        "",
    ]
    msg_lines.extend(format_breach_line(e) for e in events)
    msg_lines.append("exceeding the standard range")
    event_message = "\n".join(msg_lines)

    body = (
        f"Event Type: Equipment Production Indicator\n"
        f"Alarm Code: {alarm_code}\n"
        f"Production Line: {line}\n"
        f"Station: {station}\n"
        f"Equipment: {equipment}\n"
        f"Processing Status: Not Processed\n"
        f"Deviation Time: {deviation_str}\n"
        f"Processing Time: -\n"
        f"Duration: -\n"
        f"Event Message:\n"
        f"{event_message}\n"
    )

    # HTML variant with colors
    esc = html_lib.escape
    breach_html = "".join(
        f"<div style='margin:4px 0 0 0;'>{format_breach_line_html(e)}</div>"
        for e in events
    )
    body_html = f"""\
<html><body style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#0f172a;line-height:1.5;">
<div><b>Event Type:</b> Equipment Production Indicator</div>
<div><b>Alarm Code:</b> {esc(alarm_code)}</div>
<div><b>Production Line:</b> {esc(line)}</div>
<div><b>Station:</b> {esc(station)}</div>
<div><b>Equipment:</b> {esc(equipment)}</div>
<div><b>Processing Status:</b> Not Processed</div>
<div><b>Deviation Time:</b> {esc(deviation_str)}</div>
<div><b>Processing Time:</b> -</div>
<div><b>Duration:</b> -</div>
<div style="margin-top:12px;"><b>Event Message:</b></div>
<div style="margin-top:6px;padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;">
  <div>Line [{esc(line)}]</div>
  <div>Station [{esc(station)}]</div>
  <div>Equipment [{esc(equipment)}]</div>
  <div style="height:8px;"></div>
  {breach_html}
  <div style="margin-top:8px;">exceeding the standard range</div>
</div>
</body></html>
"""
    return subject, body, body_html


def recipients_for_process_setpoints(db: Session) -> List[str]:
    """Recipients whose group includes process_setpoint_alerts (does not touch OEE groups)."""
    from ..models import EmailGroup, EmailRecipient

    groups = db.query(EmailGroup).all()
    group_ids = []
    for g in groups:
        rts = {r.strip() for r in (g.report_types or "").split(",") if r.strip()}
        if PROCESS_SETPOINT_REPORT_KEY in rts:
            group_ids.append(g.id)
    if not group_ids:
        return []
    rows = (
        db.query(EmailRecipient)
        .filter(EmailRecipient.group_id.in_(group_ids), EmailRecipient.active == 1)
        .all()
    )
    seen, out = set(), []
    for r in rows:
        if r.email and r.email not in seen:
            seen.add(r.email)
            out.append(r.email)
    return out


def send_process_setpoint_email(
    db: Session,
    *,
    machine: Machine,
    module_id: str,
    subject: str,
    body: str,
    raised_events: List[dict],
    alert_prefix: str,
    body_html: Optional[str] = None,
) -> Optional[dict]:
    """Shared SMTP send using existing EmailSmtpConfig — separate alert_type namespace."""
    from ..models import EmailSmtpConfig, EmailLog, DeviationAlertLog, now_ist

    if not raised_events:
        return None

    DEFAULT_SENDER = "learncode612000@gmail.com"
    cfg = db.query(EmailSmtpConfig).first()
    if not cfg:
        return {
            "status": "failed",
            "message": "SMTP not configured — Alerts → Email Settings",
            "sent_at": now_ist().isoformat(timespec="seconds"),
            "module_id": module_id,
            "recipients": [],
            "event_ids": [e.get("event_id") for e in raised_events if e.get("event_id")],
        }
    if not (cfg.email_address or "").strip():
        cfg.email_address = DEFAULT_SENDER
    if not cfg.email_password:
        return {
            "status": "failed",
            "message": f"SMTP password missing for {cfg.email_address}",
            "sent_at": now_ist().isoformat(timespec="seconds"),
            "module_id": module_id,
            "recipients": [],
            "event_ids": [e.get("event_id") for e in raised_events if e.get("event_id")],
        }

    recipients = recipients_for_process_setpoints(db)
    if not recipients:
        # No Process Setpoint group / active recipients — do NOT fall back to SMTP sender
        return {
            "status": "skipped",
            "message": "No Process Setpoint Alerts recipients — create a group under Alerts → Process Setpoint Alerts",
            "sent_at": now_ist().isoformat(timespec="seconds"),
            "module_id": module_id,
            "recipients": [],
            "event_ids": [e.get("event_id") for e in raised_events if e.get("event_id")],
        }

    fresh = []
    for ev in raised_events:
        eid = str(ev.get("event_id") or "").strip()
        if not eid:
            continue
        alert_type = f"{alert_prefix}:{eid}"[:50]
        exists = (
            db.query(DeviationAlertLog)
            .filter(
                DeviationAlertLog.machine_id == machine.id,
                DeviationAlertLog.alert_type == alert_type,
            )
            .first()
        )
        if exists:
            continue
        fresh.append((ev, alert_type, eid))
    if not fresh:
        return None

    log = EmailLog(
        sent_at=now_ist(),
        recipients=", ".join(recipients),
        subject=subject,
        report_type=PROCESS_SETPOINT_REPORT_KEY,
        status="pending",
    )
    db.add(log)
    db.flush()

    try:
        from ..routers.email_router import do_send
        do_send(cfg, recipients, subject, body, body_html=body_html)
        log.status = "sent"
        delivery = "sent"
        message = f"[{module_id}] Setpoint alert sent to {', '.join(recipients)}"
    except Exception as exc:
        log.status = "failed"
        log.error_msg = str(exc)
        delivery = "failed"
        message = f"[{module_id}] Setpoint alert failed: {exc}"

    for ev, alert_type, eid in fresh:
        db.add(DeviationAlertLog(
            sent_at=now_ist(),
            alert_type=alert_type,
            machine_id=machine.id,
            status="process_setpoint",
            segment_log_id=None,
            breach_count=1,
            duration_sec=None,
            deviation_reason=(ev.get("label") or str(ev.get("tag_key") or ""))[:500],
            recipients=", ".join(recipients),
            subject=subject[:255],
            email_log_id=log.id,
            delivery_status=delivery,
            escalation_level=0,
        ))

    return {
        "status": delivery,
        "message": message,
        "sent_at": now_ist().isoformat(timespec="seconds"),
        "module_id": module_id,
        "recipients": recipients,
        "event_ids": [eid for _e, _a, eid in fresh],
        "from_email": cfg.email_address,
    }
