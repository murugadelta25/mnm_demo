# Setup-VaptEnv.ps1
# Creates isolated VAPT config files for EAP-PMS (does not start production services).
# Run from repository root:
#   .\scripts\vapt\Setup-VaptEnv.ps1

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $Root

Write-Host "== EAP-PMS VAPT environment scaffolding ==" -ForegroundColor Cyan
Write-Host "Repo: $Root"

$vaptDir = Join-Path $Root "deploy\vapt"
New-Item -ItemType Directory -Force -Path $vaptDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Root "deploy\ssl") | Out-Null

$deployExample = Join-Path $vaptDir "deploy.env.example"
$deployEnv = Join-Path $vaptDir "deploy.env"
if (-not (Test-Path $deployEnv)) {
  Copy-Item $deployExample $deployEnv
  Write-Host "Created $deployEnv"
} else {
  Write-Host "Exists (skipped): $deployEnv"
}

$domainCfg = Join-Path $vaptDir "domain.config.json"
if (-not (Test-Path $domainCfg)) {
  Write-Host "Missing domain.config.json — expected at deploy/vapt/domain.config.json"
} else {
  Write-Host "Domain config: $domainCfg"
}

# Generate a random JWT secret for VAPT
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$secret = ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""

$backendVaptEnv = Join-Path $Root "backend\.env.vapt"
if (-not (Test-Path $backendVaptEnv)) {
  @"
# VAPT-only backend environment — DO NOT use production DB
DATABASE_URL=mysql+pymysql://root:ChangeMe-VaptDb-2026!@localhost:3306/eap_pms_vapt

SECRET_KEY=$secret
ACCESS_TOKEN_EXPIRE_MINUTES=120

PLATFORM_ADMIN_USERNAME=vapt_platform_admin
PLATFORM_ADMIN_PASSWORD=ChangeMe-VaptPlatform-2026!
PLATFORM_TOKEN_EXPIRE_HOURS=8
"@ | Set-Content -Path $backendVaptEnv -Encoding UTF8
  Write-Host "Created $backendVaptEnv"
} else {
  Write-Host "Exists (skipped): $backendVaptEnv"
}

$frontendVaptEnv = Join-Path $Root "frontend\.env.vapt"
if (-not (Test-Path $frontendVaptEnv)) {
  @"
# VAPT frontend hints (adapt to your vite proxy / start script)
VITE_API_PROXY_TARGET=http://127.0.0.1:8020
PORT=5274
"@ | Set-Content -Path $frontendVaptEnv -Encoding UTF8
  Write-Host "Created $frontendVaptEnv"
} else {
  Write-Host "Exists (skipped): $frontendVaptEnv"
}

Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Edit deploy\vapt\deploy.env (DB password, ports 8020/5274)"
Write-Host "2. Edit backend\.env.vapt (DATABASE_URL, platform password)"
Write-Host "3. CREATE DATABASE eap_pms_vapt; run migrations/schema against it"
Write-Host "4. Start backend on 8020 using backend\.env.vapt"
Write-Host "5. Start frontend on 5274 proxying to 8020"
Write-Host "6. Map hosts: <server-ip> vapt.eappms"
Write-Host "7. Create VAPT role users (see docs\vapt\VAPT_SCOPE.md)"
Write-Host "8. Follow docs\vapt\VAPT_E2E_FEATURE_CHECKLIST.md"
Write-Host ""
Write-Host "Done." -ForegroundColor Green
