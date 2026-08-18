# EAP-PMS — VAPT / Staging Environment Setup

**Document ID:** EAP-PMS-VAPT-ENV-001  
**Purpose:** Create an **isolated** copy of EAP-PMS for security and end-to-end testing without touching production.

---

## 1. Isolation principles

| Item | Production (typical) | VAPT instance |
|------|----------------------|---------------|
| Domain | `din.eappms` | `vapt.eappms` |
| Frontend port | 5174 | **5274** |
| Backend port | 8010 | **8020** |
| Database name | `eap_pms` / client DB | **`eap_pms_vapt`** |
| JWT `SECRET_KEY` | production secret | **new random secret** |
| Platform admin password | production | **new test password** |
| HTTPS | as deployed | Prefer HTTPS with dedicated cert |
| Data | live | sanitized seed / dummy only |

Never point VAPT `DATABASE_URL` at the production schema.

---

## 2. Prerequisites

- Same OS stack as deploy target (Windows IPC or Ubuntu IPC)
- MySQL/MariaDB available
- Node/pnpm + Python venv as used by the project
- Optional: nginx for reverse proxy + TLS
- Copy of this repository at a known commit/tag

---

## 3. Quick setup (Windows)

From repo root:

```powershell
# 1) Generate isolated config files
.\scripts\vapt\Setup-VaptEnv.ps1

# 2) Edit secrets in:
#    deploy\vapt\deploy.env
#    backend\.env.vapt  (or path printed by script)

# 3) Create DB and apply schema (example)
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS eap_pms_vapt CHARACTER SET utf8mb4;"
# Then run your normal schema/migration path against eap_pms_vapt

# 4) Start using VAPT ports (example — adapt to your run script)
$env:BACKEND_PORT = "8020"
$env:FRONTEND_PORT = "5274"
# Start backend with DATABASE_URL pointing to eap_pms_vapt
# Start frontend with proxy to 8020
```

Templates created/used:

- `deploy/vapt/deploy.env.example` → copy to `deploy/vapt/deploy.env`
- `deploy/vapt/domain.config.json`

---

## 4. Quick setup (Ubuntu)

```bash
chmod +x scripts/vapt/setup-vapt-env.sh
./scripts/vapt/setup-vapt-env.sh

# Edit deploy/vapt/deploy.env and backend env for VAPT
# Create DB eap_pms_vapt, run migrations
# Start services on 8020 / 5274
```

---

## 5. Recommended nginx mapping (VAPT)

| Listen | Upstream |
|--------|----------|
| `vapt.eappms:80/443` | frontend `127.0.0.1:5274` |
| `/api/` and `/ws` | backend `127.0.0.1:8020` |

Use a dedicated cert under `deploy/ssl/` named for `vapt.eappms` (or internal CA-signed).

Hosts entry (server + tester PCs if no LAN DNS):

```
<VAPT_SERVER_IP>  vapt.eappms
```

---

## 6. Seed VAPT users

Create users via User Management (as superadmin) or SQL seed:

| Username | Role |
|----------|------|
| `vapt_operator` | operator |
| `vapt_quality` | quality |
| `vapt_maint` | maintenance |
| `vapt_supervisor` | supervisor |
| `vapt_admin` | admin |
| `vapt_superadmin` | superadmin |

Also set platform admin via VAPT env (`PLATFORM_ADMIN_USERNAME` / `PLATFORM_ADMIN_PASSWORD`).

Use strong unique test passwords; store in the VAPT credential vault shared with testers.

---

## 7. Pre-test readiness checklist

- [ ] VAPT DB is not production
- [ ] Ports 5274/8020 respond
- [ ] `https://vapt.eappms` (or HTTP staging URL) loads login
- [ ] All six roles can log in
- [ ] Platform login works on `/platform/login`
- [ ] Backup of VAPT DB taken before destructive tests
- [ ] Application commit/tag recorded in scope doc
- [ ] Logging enabled for auth failures
- [ ] Swagger `/docs` status documented (enabled/disabled/protected)

---

## 8. Teardown

After assessment:

1. Stop VAPT frontend/backend/nginx site for `vapt.eappms`
2. Drop or archive `eap_pms_vapt`
3. Rotate any secrets that were shared with testers
4. Remove tester host firewall exceptions
5. Archive reports under controlled storage

---

## 9. Safety notes

- Do not enable production autologin secrets on VAPT if avoidable; if present, treat `/autologin` as high-risk and in-scope.
- Do not reuse production `SECRET_KEY`.
- Prefer sanitized machine/operator names (no real employee PII).
