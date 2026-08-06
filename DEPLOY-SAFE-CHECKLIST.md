# Deploy Safe Checklist

Use this checklist before `git pull` / restart on the Ubuntu server so code updates do not make data appear missing.

## What this protects against

- `DATABASE_URL` pointing to the wrong or empty database
- missing tables / columns after a code update
- destructive or risky migrations
- missing uploaded runtime files such as factory logos or part images
- backend startup failures that make the UI look empty even when data still exists

## One-command preflight

Preferred workflow:

```bash
cd /path/to/Groz_eap_pms
./run.sh preflight
```

What `preflight` does:

1. loads deploy config
2. installs or verifies dependencies
3. syncs backend/frontend env files
4. creates a safe DB backup if the DB already exists
5. runs SQL migrations
6. runs `backend/ensure_schema.py` to add missing web/mobile schema items

It does **not** start or restart services.

## Safe production update

Run these in order (**pull first**, so new migrations are on disk before schema guard runs):

```bash
cd /path/to/Groz_eap_pms
git pull origin main
./run.sh preflight
./run.sh restart
```

`./run.sh restart` also re-runs `scripts/setup-database.sh` (backup if DB exists + SQL migrations + `ensure_schema.py`). Existing rows are never truncated or dropped — only missing tables/columns/ENUMs are added.

Keep `deploy.env`, `database/db.config.json`, and `backend/.env` as local files (they are gitignored). Do not overwrite them after pull.

## Verify the app still points to the correct DB

Check the configured DB:

```bash
grep '^DATABASE_URL=' backend/.env
cat database/db.config.json
```

Confirm the live DB still contains your data:

```bash
mysql -u YOUR_USER -p -e "
SELECT COUNT(*) AS machines FROM YOUR_DB.machines;
SELECT COUNT(*) AS stations FROM YOUR_DB.stations;
SELECT COUNT(*) AS site_config_rows FROM YOUR_DB.site_config;
"
```

If these counts are non-zero, the data is still present.

## Review migrations before production restart

Before applying a new pull, review DB-affecting changes:

```bash
git diff HEAD~1..HEAD -- database/ backend/app/main.py backend/*.py
```

Watch for risky operations like:

- `DROP TABLE`
- `TRUNCATE`
- `DELETE FROM`
- `ALTER TABLE ... DROP COLUMN`
- table recreation instead of additive alters

## Back up uploaded runtime files

Git does not protect uploaded runtime assets. Back them up separately:

```bash
tar -czf runtime_static_backup.tgz \
  backend/static/factory \
  backend/static/parts \
  backend/static/work-instructions
```

## Health checks after restart

After restart:

```bash
curl http://127.0.0.1:8010/health
curl http://127.0.0.1:8010/health/db
curl -i http://127.0.0.1:8010/api/machines/
curl -i http://127.0.0.1:8010/api/notifications/
```

Expected result:

- `/health` => 200
- `/health/db` => 200
- `/api/machines/` => not 500
- `/api/notifications/` => not 500

## If the UI looks empty after pull

Usually this means one of these:

1. wrong DB selected in `backend/.env`
2. backend API crashed with 500 due to schema drift
3. uploaded files were deleted from disk

It does **not** usually mean the DB data was actually erased.

## Log checks

If something still fails:

```bash
./run.sh logs
```

or:

```bash
sudo journalctl -u <backend-service-name> -n 200 --no-pager
```

## Recovery rule

If the data looks gone:

1. check DB row counts first
2. check backend logs second
3. restore backups only after confirming the DB is actually missing data

