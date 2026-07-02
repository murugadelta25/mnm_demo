import os
from dotenv import load_dotenv

load_dotenv()

SMTP_SERVER   = os.getenv("SMTP_SERVER",   "smtp.gmail.com")
SMTP_PORT     = int(os.getenv("SMTP_PORT", "587"))
EMAIL_ADDRESS = os.getenv("EMAIL_ADDRESS", "learncode612000@gmail.com")
EMAIL_PASSWORD = os.getenv("EMAIL_PASSWORD", "vxmq pftg mhzg ljsc")   # set in .env — never hardcode

REPORT_FOLDER = os.getenv("REPORT_FOLDER", "reports")
UPLOAD_FOLDER = os.getenv("UPLOAD_FOLDER", "uploads")
