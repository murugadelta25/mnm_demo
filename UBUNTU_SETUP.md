# Titan OEE — Ubuntu Server Setup & Network Access Guide

## ✅ Can Windows computers on the same network access it?

**Yes.** When the app runs on Ubuntu with `host: 0.0.0.0`, every device on the
same LAN (Windows PCs, tablets, phones) can open the dashboard in a browser.

```
Ubuntu Server IP: 192.168.1.100  (example — find yours with: hostname -I)

From any Windows PC on the same network:
  http://192.168.1.100:5173   ← Dashboard
  http://192.168.1.100:8000   ← API
  http://192.168.1.100:8000/docs ← API Docs
```

No installation needed on the Windows clients — just a browser.

---

## Step 1 — Package on Windows

Run this in PowerShell from the project root:

```powershell
cd "d:\Project documents\2026\TITAN_DEMO_Update\titan-oee"
.\PACKAGE.ps1
```

This creates `titan-oee.zip` (~2–5 MB, excludes node_modules/venv).

---

## Step 2 — Transfer to Ubuntu Server

### Option A — SCP (recommended, requires SSH)
```powershell
# From Windows PowerShell
scp titan-oee.zip ubuntu@192.168.1.100:~/
```

### Option B — USB Drive
Copy `titan-oee.zip` to a USB drive, plug into Ubuntu server, then:
```bash
cp /media/usb/titan-oee.zip ~/
```

### Option C — Shared Network Folder
If Ubuntu has Samba or you have a shared folder, copy the zip there.

---

## Step 3 — Deploy on Ubuntu (one command)

SSH into your Ubuntu server:
```bash
ssh ubuntu@192.168.1.100
```

Then:
```bash
cd ~
unzip titan-oee.zip
cd titan-oee
chmod +x deploy.sh
./deploy.sh
```

The deploy script automatically:
- Installs Python3, Node.js 20, MySQL (if missing)
- Creates the database and user
- Runs schema.sql + all migrations
- Sets `frontend/.env` to your server's LAN IP
- Installs all Python and npm packages
- Opens firewall ports 5173 and 8000
- Optionally installs systemd services (auto-start on boot)
- Starts the application

---

## Step 4 — Access from Windows PCs

Open any browser on any Windows PC on the same network:
```
http://192.168.1.100:5173
```

Default login: `SuperAdmin` / `Password@123` (superadmin). Also seeded: `admin` / `admin123`.

---

## Re-deploying (after updates)

### Preferred — GitHub pull (existing DB kept)

On the Ubuntu server (same clone that already has `deploy.env` / `database/db.config.json`):

```bash
cd /path/to/Groz_eap_pms
git pull origin main
./run.sh preflight    # backup existing DB + apply additive schema
./run.sh restart      # deps + schema guard again + systemd restart
```

- Local secrets (`deploy.env`, `database/db.config.json`, `backend/.env`) are gitignored and stay in place.
- Existing tables and rows are preserved.
- Missing tables/columns are created automatically via `scripts/setup-database.sh` → `backend/ensure_schema.py` and app startup migrations in `backend/app/main.py`.

See **`DEPLOY-SAFE-CHECKLIST.md`** for verification steps.

### Alternate — zip package (legacy)

On Windows, re-run the package script:
```powershell
.\PACKAGE.ps1
```

Transfer the new zip and on Ubuntu:
```bash
cd ~
unzip -o titan-oee.zip   # -o overwrites existing files
cd titan-oee
./deploy.sh              # re-runs safely, skips already-done steps
```

---

## Daily Start / Stop (without systemd)

```bash
cd ~/titan-oee

./start.sh          # start both
./start.sh stop     # stop both
./start.sh backend  # backend only
./start.sh frontend # frontend only

tail -f backend.log   # view backend logs
tail -f frontend.log  # view frontend logs
```

---

## With systemd (auto-start on boot)

The deploy script offers to install systemd services.
If you chose yes, the app starts automatically when Ubuntu boots.

```bash
# Manual control
sudo systemctl start   titan-backend titan-frontend
sudo systemctl stop    titan-backend titan-frontend
sudo systemctl restart titan-backend titan-frontend
sudo systemctl status  titan-backend
```

---

## Troubleshooting

### Windows PC can't reach the server
```bash
# On Ubuntu — check firewall
sudo ufw status
sudo ufw allow 5173/tcp
sudo ufw allow 8000/tcp

# Check services are listening on 0.0.0.0 (not just 127.0.0.1)
ss -tlnp | grep -E '5173|8000'
```

### Frontend shows API errors
```bash
# Check frontend/.env has the correct server IP (not localhost)
cat ~/titan-oee/frontend/.env
# Should show: VITE_API_URL=http://192.168.1.100:8000

# If wrong, fix and restart frontend
echo "VITE_API_URL=http://$(hostname -I | awk '{print $1}'):8000" > ~/titan-oee/frontend/.env
echo "VITE_WS_URL=ws://$(hostname -I | awk '{print $1}'):8000"   >> ~/titan-oee/frontend/.env
./start.sh stop && ./start.sh
```

### MySQL connection error
```bash
# Check MySQL is running
sudo systemctl status mysql

# Test connection
mysql -u titan_user -p eap_pms -e "SELECT 1;"
```

### Check what's running
```bash
ps aux | grep uvicorn   # backend
ps aux | grep vite      # frontend
```

---

## Quick Reference

| Task | Command |
|---|---|
| Package on Windows | `.\PACKAGE.ps1` |
| Transfer via SCP | `scp titan-oee.zip ubuntu@<ip>:~/` |
| First-time deploy | `./deploy.sh` |
| Start all | `./start.sh` |
| Stop all | `./start.sh stop` |
| View backend log | `tail -f backend.log` |
| View frontend log | `tail -f frontend.log` |
| Find server IP | `hostname -I` |
| Restart services | `sudo systemctl restart titan-backend titan-frontend` |
