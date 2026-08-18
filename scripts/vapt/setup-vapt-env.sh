#!/usr/bin/env bash
# setup-vapt-env.sh — scaffold isolated VAPT config for EAP-PMS
# Run from repository root:
#   chmod +x scripts/vapt/setup-vapt-env.sh
#   ./scripts/vapt/setup-vapt-env.sh

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

echo "== EAP-PMS VAPT environment scaffolding =="
echo "Repo: $ROOT"

mkdir -p deploy/vapt deploy/ssl

if [[ ! -f deploy/vapt/deploy.env ]]; then
  cp deploy/vapt/deploy.env.example deploy/vapt/deploy.env
  echo "Created deploy/vapt/deploy.env"
else
  echo "Exists (skipped): deploy/vapt/deploy.env"
fi

SECRET="$(openssl rand -hex 32 2>/dev/null || python3 -c 'import secrets; print(secrets.token_hex(32))')"

if [[ ! -f backend/.env.vapt ]]; then
  cat > backend/.env.vapt <<EOF
# VAPT-only backend environment — DO NOT use production DB
DATABASE_URL=mysql+pymysql://root:ChangeMe-VaptDb-2026!@localhost:3306/eap_pms_vapt

SECRET_KEY=${SECRET}
ACCESS_TOKEN_EXPIRE_MINUTES=120

PLATFORM_ADMIN_USERNAME=vapt_platform_admin
PLATFORM_ADMIN_PASSWORD=ChangeMe-VaptPlatform-2026!
PLATFORM_TOKEN_EXPIRE_HOURS=8
EOF
  echo "Created backend/.env.vapt"
else
  echo "Exists (skipped): backend/.env.vapt"
fi

if [[ ! -f frontend/.env.vapt ]]; then
  cat > frontend/.env.vapt <<EOF
# VAPT frontend hints (adapt to your vite proxy / start script)
VITE_API_PROXY_TARGET=http://127.0.0.1:8020
PORT=5274
EOF
  echo "Created frontend/.env.vapt"
else
  echo "Exists (skipped): frontend/.env.vapt"
fi

echo
echo "Next steps:"
echo "1. Edit deploy/vapt/deploy.env (DB password, ports 8020/5274)"
echo "2. Edit backend/.env.vapt (DATABASE_URL, platform password)"
echo "3. mysql -e \"CREATE DATABASE eap_pms_vapt CHARACTER SET utf8mb4;\""
echo "4. Run migrations/schema against eap_pms_vapt"
echo "5. Start backend on 8020 with backend/.env.vapt"
echo "6. Start frontend on 5274 proxying to 8020"
echo "7. Map hosts: <server-ip> vapt.eappms"
echo "8. Create VAPT role users (docs/vapt/VAPT_SCOPE.md)"
echo "9. Execute docs/vapt/VAPT_E2E_FEATURE_CHECKLIST.md"
echo
echo "Done."
