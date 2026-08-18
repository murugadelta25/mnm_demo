# VAPT deploy configuration

Isolated deployment settings for the EAP-PMS **VAPT/staging** environment. Do not use these files for production.

## Files

| File | Purpose |
|------|---------|
| `deploy.env.example` | Template: DB name `eap_pms_vapt`, ports **8020** / **5274**, `CLIENT_NAME=vapt` |
| `domain.config.json` | Domain `vapt.eappms`, HTTPS enabled, cert paths under `deploy/ssl/` |

## Setup

1. Copy `deploy.env.example` → `deploy.env` and set DB password and ports.
2. Run environment scaffold from repo root:
   - Windows: `.\scripts\vapt\Setup-VaptEnv.ps1`
   - Ubuntu: `./scripts/vapt/setup-vapt-env.sh`
3. Follow `docs/vapt/VAPT_ENVIRONMENT_SETUP.md`.

## Local secrets (do not commit)

Add to root `.gitignore` if not already present:

```gitignore
backend/.env.vapt
frontend/.env.vapt
deploy/vapt/deploy.env
```

## Documentation

Full VAPT pack index: **`docs/vapt/README.md`**
