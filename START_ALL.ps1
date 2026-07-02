# START_ALL.ps1 — Start PMS Dashboard on Windows
# Run from project root: .\START_ALL.ps1

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend  = Join-Path $root "backend"
$frontend = Join-Path $root "frontend"

Write-Host "▶ Starting Backend..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", @"
  cd '$backend'
  if (-not (Test-Path 'venv')) { python -m venv venv }
  .\venv\Scripts\Activate.ps1
  uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
"@

Start-Sleep -Seconds 2

Write-Host "▶ Starting Frontend..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", @"
  cd '$frontend'
  npm run dev
"@

Write-Host ""
Write-Host "✅ PMS Dashboard starting..." -ForegroundColor Green
Write-Host "   Frontend : http://localhost:5173" -ForegroundColor Yellow
Write-Host "   Backend  : http://localhost:8000" -ForegroundColor Yellow
Write-Host "   API Docs : http://localhost:8000/docs" -ForegroundColor Yellow
