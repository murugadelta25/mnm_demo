#Complete Guide: to keep the service in the system service for auto restart on reboot and crash

1. Create the backend service file
sudo nano /etc/systemd/system/titan-backend.service

Copy
Paste this:

[Unit]
Description=Titan OEE Backend
After=network.target mysql.service
Requires=mysql.service

[Service]
User=sie
WorkingDirectory=/home/sie/Downloads/titan-oee_v1/backend
ExecStart=/home/sie/Downloads/titan-oee_v1/backend/venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8010
Restart=always
RestartSec=5
StandardOutput=append:/home/sie/Downloads/titan-oee_v1/backend.log
StandardError=append:/home/sie/Downloads/titan-oee_v1/backend.log
Environment=PATH=/home/sie/Downloads/titan-oee_v1/backend/venv/bin:/usr/bin:/bin

[Install]
WantedBy=multi-user.target

Copy
ini
2. Create the frontend service file
sudo nano /etc/systemd/system/titan-frontend.service

Copy
bash
Paste this:

[Unit]
Description=Titan OEE Frontend
After=network.target titan-backend.service

[Service]
User=sie
WorkingDirectory=/home/sie/Downloads/titan-oee_v1/frontend
ExecStart=/usr/bin/node node_modules/vite/bin/vite.js --host --port 5174
Restart=always
RestartSec=5
StandardOutput=append:/home/sie/Downloads/titan-oee_v1/frontend.log
StandardError=append:/home/sie/Downloads/titan-oee_v1/frontend.log
Environment=PATH=/usr/bin:/bin

[Install]
WantedBy=multi-user.target

Copy
ini
3. Enable and start
sudo systemctl daemon-reload
sudo systemctl enable titan-backend titan-frontend
sudo systemctl start titan-backend titan-frontend

Copy
bash
4. Verify
sudo systemctl status titan-backend titan-frontend

Copy
bash
Day-to-Day Commands
Task	Command
Restart after code changes	sudo systemctl restart titan-backend
Stop both	sudo systemctl stop titan-backend titan-frontend
Start both	sudo systemctl start titan-backend titan-frontend
Live backend logs	sudo journalctl -u titan-backend -f
Live frontend logs	sudo journalctl -u titan-frontend -f
Check if enabled on boot	sudo systemctl is-enabled titan-backend
Key Concepts
[Unit] — defines dependencies (After=mysql.service means wait for MySQL before starting)

[Service] — the actual process config (Restart=always + RestartSec=5 = auto-restart 5s after crash)

[Install] — WantedBy=multi-user.target means start at normal system boot (runlevel 3/5 equivalent)

daemon-reload — must run every time you edit a .service file

enable — creates a symlink in /etc/systemd/system/multi-user.target.wants/ so it starts on boot

start — starts it right now without needing a reboot

==============================================================================================================================================

These services were added by creating service unit files in /etc/systemd/system/. Here's exactly how it was done and how to do it yourself:

How It Was Done (What Already Exists)
Someone ran these steps at some point on your machine:

Step 1 — Created the service files

sudo nano /etc/systemd/system/titan-backend.service
sudo nano /etc/systemd/system/titan-frontend.service

Copy
bash
Step 2 — Reloaded systemd and enabled them

sudo systemctl daemon-reload
sudo systemctl enable titan-backend titan-frontend
sudo systemctl start titan-backend titan-frontend

Copy
bash
That's it. Once enabled, they survive reboots and auto-restart on crash.