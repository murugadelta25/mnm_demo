
from fastapi import FastAPI, Request, Form
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from .email_service import send_email
from .scheduler import start_scheduler, stop_scheduler

app = FastAPI()

@app.on_event("startup")
def on_startup():
    start_scheduler()

@app.on_event("shutdown")
def on_shutdown():
    stop_scheduler()

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    return templates.TemplateResponse("index.html", {
        "request": request,
        "message": ""
    })

@app.post("/send_email", response_class=HTMLResponse)
async def send_email_route(
    request: Request,
    recipients: str = Form(...),
    subject: str = Form(...),
    body: str = Form(...),
    auto_attach: str = Form(None)
):
    recipient_list = [x.strip() for x in recipients.split(",")]

    send_email(
        recipient_list,
        subject,
        body,
        auto_attach=True if auto_attach else False
    )

    return templates.TemplateResponse("index.html", {
        "request": request,
        "message": "Email sent successfully!"
    })
