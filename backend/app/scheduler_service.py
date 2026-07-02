from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy.orm import Session
from datetime import datetime
import pytz
_IST = pytz.timezone('Asia/Kolkata')
def now_ist(): return datetime.now(_IST).replace(tzinfo=None)

scheduler = BackgroundScheduler(timezone="Asia/Kolkata", job_defaults={'misfire_grace_time': 3600})

def _send_scheduled(schedule_id: int):
    """Called by APScheduler — creates its own DB session"""
    from .models import EmailSchedule, EmailSmtpConfig, EmailGroup, EmailLog, SessionLocal
    from .routers.email_router import get_group_emails, do_send, build_attachments_for_report_types
    from datetime import timedelta
    db: Session = SessionLocal()
    try:
        s = db.query(EmailSchedule).filter(EmailSchedule.id == schedule_id,
                                           EmailSchedule.active == 1).first()
        if not s: return
        cfg = db.query(EmailSmtpConfig).first()
        if not cfg or not cfg.email_address: return

        group_ids = [int(x) for x in s.group_ids.split(",") if x.strip()]
        to_list = get_group_emails(db, group_ids)
        if not to_list: return

        # Report covers previous day's completed data
        report_date = (datetime.now().date() - timedelta(days=1))
        report_date_str = report_date.strftime('%d-%m-%Y')

        subject = f"[PMS] {s.report_type.capitalize()} Report — {report_date_str}"
        body = (f"Dear Team,\n\nPlease find the {s.report_type} production report for {report_date_str} attached.\n\n"
                f"Generated: {datetime.now().strftime('%d-%m-%Y %H:%M:%S')}\n\nDelta EAP+ PMS System")

        attachments = {}
        if s.attach_report:
            grps = db.query(EmailGroup).filter(EmailGroup.id.in_(group_ids)).all()
            combined = set()
            for grp in grps:
                for r in (grp.report_types or "oee,planning,breakdown").split(","):
                    combined.add(r.strip())
            attachments = build_attachments_for_report_types(",".join(combined), db, report_date)

        log = EmailLog(
            sent_at=now_ist(), recipients=", ".join(to_list),
            subject=subject, report_type="scheduled", status="pending"
        )
        db.add(log)
        db.commit()

        try:
            do_send(cfg, to_list, subject, body, attachments)
            log.status = "sent"
            print(f"[Scheduler] Schedule {schedule_id} sent to {len(to_list)} recipient(s)")
        except Exception as e:
            log.status = "failed"
            log.error_msg = str(e)
            print(f"[Scheduler] Send failed for schedule {schedule_id}: {e}")

        s.last_sent = now_ist()
        db.commit()
    except Exception as e:
        print(f"[Scheduler] Error for schedule {schedule_id}: {e}")
    finally:
        db.close()

def _scan_deviation_breaches():
    """Periodic job — alert on ongoing threshold breaches."""
    from .models import SessionLocal
    from .deviation_alert_service import scan_ongoing_breaches
    db = SessionLocal()
    try:
        sent = scan_ongoing_breaches(db)
        if sent:
            print(f"[DeviationAlert] Ongoing breach scan sent {sent} alert(s)")
    except Exception as exc:
        print(f"[DeviationAlert] Scan failed: {exc}")
    finally:
        db.close()


def reload_schedules(db: Session):
    """Remove all existing jobs and re-add from DB"""
    from .models import EmailSchedule
    for job in scheduler.get_jobs():
        job.remove()

    schedules = db.query(EmailSchedule).filter(EmailSchedule.active == 1).all()
    for s in schedules:
        scheduler.add_job(
            _send_scheduled,
            trigger='cron',
            hour=s.send_hour,
            minute=s.send_minute,
            args=[s.id],
            id=f"schedule_{s.id}",
            replace_existing=True
        )
    print(f"[Scheduler] Loaded {len(schedules)} active schedule(s)")

    if not scheduler.get_job('deviation_breach_scan'):
        scheduler.add_job(
            _scan_deviation_breaches,
            trigger='interval',
            minutes=5,
            id='deviation_breach_scan',
            replace_existing=True,
        )
        print("[Scheduler] Deviation breach scan every 5 minutes")

def start_scheduler(db: Session = None):
    if not scheduler.running:
        scheduler.start()
    if db:
        reload_schedules(db)

def stop_scheduler():
    if scheduler.running:
        scheduler.shutdown(wait=False)
