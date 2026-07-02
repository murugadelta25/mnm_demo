from apscheduler.schedulers.background import BackgroundScheduler
from .email_service import send_email

scheduler = BackgroundScheduler()

def daily_report():
    send_email(
        ["manager@company.com"],
        "Daily Production Report",
        "Attached is the daily production report.",
        auto_attach=True
    )

scheduler.add_job(daily_report, 'cron', hour=18, minute=0)

def start_scheduler():
    if not scheduler.running:
        scheduler.start()

def stop_scheduler():
    if scheduler.running:
        scheduler.shutdown(wait=False)
