# Process Setpoint Email Alerts

Separate from classic **Email Alerts** (OEE / schedules / deviation).  
Report type key: `process_setpoint_alerts`.

## Configure SMTP (once)

1. Open **Alerts → Email Alerts → SMTP Settings**.
2. Server: `smtp.gmail.com`, Port: `587`.
3. Address: `learncode612000@gmail.com` (or your sender).
4. Password: Gmail **App Password** (Google Account → Security → 2-Step → App passwords). Spaces in the 16-char password are OK — the app strips them.
5. Click **Save**, then **Test SMTP**.

You can also set `EMAIL_ADDRESS` / `EMAIL_PASSWORD` in `email/config.py` or `.env`; the UI SMTP row overrides when saved to the DB.

## Configure Process Setpoint groups (does not change OEE groups)

1. Open **Alerts → Process Setpoint Alerts**.
2. **Create Group** (e.g. `AH PLC Setpoints`). The group is stamped with report type `process_setpoint_alerts` only.
3. **Add recipient** emails for that group.
4. Open **Overview → Equipment** for the machine → **Parameters → Set Limits** (LSL / USL) for Pressure, Flow, Tank Level, Temperature.
5. When live Modbus/SIE values cross a limit, the matching **machine-family module** sends email from the SMTP sender.

If the Process Setpoint group is deleted (or has no active recipients), **no setpoint emails are sent** — there is no fallback to the SMTP From address.

## How setpoints map to modules

| Module id | Machine family | Active today |
|-----------|----------------|--------------|
| `spm_ah_plc` | SPM AH PLC | Yes — LSL/USL process tags |
| `generic_plc` | Plain PLC | Yes |
| `servo_press` | Servo Press | Placeholder (alarms already elsewhere) |
| `linear_motor` | Servo Linear Motor | Placeholder |
| `spm` | Other SPM | Placeholder |

Backend packages (loaded separately so the app stays light):

- `backend/app/process_alert_modules/spm_ah_plc.py`
- `backend/app/process_alert_modules/generic_plc.py`
- `backend/app/process_alert_modules/servo_press.py`
- `backend/app/process_alert_modules/linear_motor.py`
- `backend/app/process_alert_modules/spm_generic.py`
- Registry: `backend/app/process_alert_modules/__init__.py`
- API: `/api/process-setpoint-alerts/*`

## Email format (process setpoint)

**Subject:** `Alarm Alert - {alarm_code} | {line} | {station}`

**Body:**
```
Event Type: Equipment Production Indicator
Alarm Code: …
Production Line: …
Station: …
Equipment: …
Processing Status: Not Processed
Deviation Time: YYYY-MM-DD HH:MM:SS
Processing Time: -
Duration: -
Event Message:
Line […]
Station […]
Equipment […]

Pressure above USL = 98 kPa (set USL = 90 kPa and LSL = 60 kPa)
Flow above USL = 98 L/min (set USL = 95 L/min and LSL = 50 L/min)
exceeding the standard range
```

HTML mail highlights the deviant value in **red** and USL/LSL limits in **blue**. Overview URL links are not included.


## Port hang / 502 Bad Gateway

If Create Group times out or returns **502**:

1. Backend on `:8010` is listening but not answering (zombie uvicorn), or Vite proxy on `:5174` cannot reach it.
2. Stop old windows, then from the repo root run:

```powershell
.\run.ps1
```

`run.ps1` clears **all** listeners on ports `8010` and `5174` before start. Prefer **without** `-Reload` on the shop floor — `--reload` orphans often leave hung sockets.
