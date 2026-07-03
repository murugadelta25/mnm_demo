# Register din.eappms on the IPC SERVER (this PC).
# Maps din.eappms -> 127.0.0.1 so the browser can open http://din.eappms locally.
#
# Easiest: Right-click Setup-Server-Host.bat -> Run as administrator

param(
    [string]$Domain = "din.eappms",
    [string]$Ip = "127.0.0.1"
)

$ErrorActionPreference = "Stop"

$configPath = Join-Path $PSScriptRoot "domain.config.json"
if (Test-Path $configPath) {
    $raw = Get-Content $configPath -Raw | ConvertFrom-Json
    if ($raw.domain) { $Domain = [string]$raw.domain }
}

function Test-IsAdmin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $p = New-Object Security.Principal.WindowsPrincipal($id)
    return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-IsAdmin)) {
    Write-Host "[FAIL] Run as Administrator." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "  EAP PMS - IPC server hostname setup" -ForegroundColor Cyan
Write-Host "  Adds: $Ip -> $Domain" -ForegroundColor White
Write-Host ""

$hostsPath = "$env:SystemRoot\System32\drivers\etc\hosts"
$lines = @(Get-Content $hostsPath -ErrorAction SilentlyContinue)
$escaped = [regex]::Escape($Domain)
$filtered = $lines | Where-Object { $_ -notmatch "\s$escaped(\s|$)" }
($filtered + @("", "# EAP PMS IPC server - Setup-Server-Host.ps1", "$Ip`t$Domain")) |
    Set-Content -Path $hostsPath -Encoding ASCII

ipconfig /flushdns | Out-Null

Write-Host "[OK] Hosts file updated: $Ip $Domain" -ForegroundColor Green

$port = Test-NetConnection -ComputerName 127.0.0.1 -Port 80 -WarningAction SilentlyContinue
if ($port.TcpTestSucceeded) {
    Write-Host "[OK] nginx port 80 is listening" -ForegroundColor Green
} else {
    Write-Host "[WARN] Port 80 not open - run run.ps1 first (nginx)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "  Open: http://$Domain" -ForegroundColor Green
Write-Host ""

Start-Process "http://$Domain"
