# Plant seed (machines, telemetry tags, site config, factory assets)

`plant_config_machines.json.gz` is a lean export of stations, machines, site
configuration, telemetry tags, parts, users, and email groups from the
development plant DB.

Packaged images live under `static/` (machines, factory logos, parts,
work-instructions) and are copied into `backend/static/` on restore.

SMTP password is **not** stored in the seed (public repo). Re-enter it under
Email Settings on the target IPC.

## Refresh from a configured Windows/dev PC

With MySQL running and `backend/.env` pointing at the plant DB:

```bash
# Windows
backend\.venv\Scripts\python.exe scripts\export_plant_seed.py

# Ubuntu
source backend/venv/bin/activate   # or backend/.venv
python3 scripts/export_plant_seed.py
```

Then commit and push `database/seeds/` to GitHub.

## Ubuntu / `run.sh`

On database setup the installer:

1. Copies seed static assets into `backend/static/`
2. Restores this seed **only if** the `machines` table is empty
3. Sets portal **siteTitle** from `CLIENT_NAME` (e.g. `MAHINDRA_HYD` → `Mahindra Hyd (PMS)`)

After `git pull`, re-run:

```bash
sudo ./run.sh restart
```

If MySQL still fails with the old `root:YourPassword` / example URL, set the app user in `deploy.env`:

```bash
# deploy.env
CLIENT_NAME=MAHINDRA_HYD
DB_USER=mnm_user
DB_PASS=mnm_pass123
DB_NAME=mahindra_hyd
```

Then `sudo ./run.sh restart` — the installer creates/updates that MySQL user and syncs `backend/.env`.

Then hard-refresh the browser (Ctrl+F5). Confirm branding:

```bash
curl -s http://localhost:8010/api/config/branding
```

## Manual restore (force overwrite machines / factory config)

Use when the Ubuntu DB already has machines but you want this plant snapshot:

```bash
cd /path/to/mnm_demo
source backend/venv/bin/activate   # or backend/.venv
CLIENT_NAME=MAHINDRA_HYD python3 scripts/restore_demo_seed.py --force
CLIENT_NAME=MAHINDRA_HYD python3 scripts/apply_client_branding.py --force
sudo systemctl restart mahindra_hyd-backend
```

## Troubleshooting: 502 Bad Gateway after git pull

If all API calls return 502, nginx is proxying to the wrong backend port.
This happens when another project's service was previously on port 8010.

1. Confirm backend is on 8010: `sudo systemctl status mahindra_hyd-backend`
2. Fix nginx if it has the wrong port:
   ```bash
   sudo sed -i 's/127.0.0.1:8011/127.0.0.1:8010/g' /etc/nginx/sites-enabled/eappms-*
   sudo nginx -t && sudo systemctl reload nginx
   ```
3. Remove any conflicting service permanently:
   ```bash
   sudo systemctl stop <other>-backend.service
   sudo systemctl disable <other>-backend.service
   sudo rm /etc/systemd/system/<other>-backend.service
   sudo systemctl daemon-reload
   ```
