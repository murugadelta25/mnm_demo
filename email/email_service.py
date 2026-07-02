
import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders
from .config import *

def attach_file(msg, filepath):
    if os.path.exists(filepath):
        with open(filepath, 'rb') as attachment:
            part = MIMEBase('application', 'octet-stream')
            part.set_payload(attachment.read())
            encoders.encode_base64(part)
            part.add_header(
                'Content-Disposition',
                f'attachment; filename={os.path.basename(filepath)}'
            )
            msg.attach(part)

def send_email(recipients, subject, body, auto_attach=False):
    msg = MIMEMultipart()
    msg['From'] = EMAIL_ADDRESS
    msg['To'] = ",".join(recipients)
    msg['Subject'] = subject

    msg.attach(MIMEText(body, 'plain'))

    if auto_attach:
        for file in os.listdir(REPORT_FOLDER):
            attach_file(msg, os.path.join(REPORT_FOLDER, file))

    server = smtplib.SMTP(SMTP_SERVER, SMTP_PORT)
    server.starttls()
    server.login(EMAIL_ADDRESS, EMAIL_PASSWORD)
    server.sendmail(EMAIL_ADDRESS, recipients, msg.as_string())
    server.quit()
