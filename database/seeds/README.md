# Plant seed (machines, telemetry tags, site config)

`plant_config_machines.json.gz` is a lean export of stations, machines, site
configuration, telemetry tags, parts, and users from the development plant DB.

## Ubuntu / `run.sh`

On database setup the installer:

1. Restores this seed **only if** the `machines` table is empty
2. Sets portal **siteTitle** from `CLIENT_NAME` (e.g. `MAHINDRA_HYD` → `Mahindra Hyd (PMS)`), replacing stale titles such as Groz

After `git pull`, re-run:

```bash
sudo ./run.sh restart
```

Then hard-refresh the browser (Ctrl+F5). Confirm branding:

```bash
curl -s http://localhost:8010/api/config/branding
```

## Manual restore (force)

```bash
cd /path/to/mnm_demo
source backend/venv/bin/activate   # or backend/.venv
CLIENT_NAME=MAHINDRA_HYD python3 scripts/restore_demo_seed.py --force
CLIENT_NAME=MAHINDRA_HYD python3 scripts/apply_client_branding.py --force
sudo systemctl restart mahindra_hyd-backend
```
