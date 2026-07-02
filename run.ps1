# Titan OEE + CPLM UI - Windows quick launcher
# Usage: .\run.ps1
# Note: ASCII-only output for Windows PowerShell encoding compatibility

$ErrorActionPreference = "Stop"
$ProjectDir = $PSScriptRoot
$BackendDir = Join-Path $ProjectDir "backend"
$FrontendDir = Join-Path $ProjectDir "frontend"
$BackendPort = 8010
$FrontendPort = 5174
$TotalSteps = 5

function Write-BannerLine {
    Write-Host "================================================" -ForegroundColor Cyan
}

function Write-StepHeader {
    param([int]$Step, [string]$Message)
    Write-Host "[$Step/$TotalSteps] $Message" -ForegroundColor Cyan
}

function Write-StepOk {
    param([string]$Message)
    Write-Host "  [OK] $Message" -ForegroundColor Green
}

function Write-StepFail {
    param([string]$Message)
    Write-Host "  [FAIL] $Message" -ForegroundColor Red
}

function Get-DatabaseCredentials {
    $configFile = Join-Path $ProjectDir "database\db.config.json"
    if (Test-Path $configFile) {
        $raw = Get-Content $configFile -Raw | ConvertFrom-Json
        return @{
            User     = if ($raw.user) { [string]$raw.user } else { "root" }
            Password = [string]$raw.password
            Database = [string]$raw.database
        }
    }
    $envFile = Join-Path $BackendDir ".env"
    if (-not (Test-Path $envFile)) {
        return @{ User = "root"; Password = ""; Database = "eap_pms" }
    }
    $line = Get-Content $envFile | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
    if ($line -match 'mysql\+pymysql://([^:]+):([^@]+)@[^/]+/([^?]+)') {
        return @{
            User     = $Matches[1]
            Password = [uri]::UnescapeDataString($Matches[2])
            Database = $Matches[3]
        }
    }
    return @{ User = "root"; Password = ""; Database = "eap_pms" }
}

function Get-MySqlExe {
    $candidates = @(
        "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe",
        "C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe",
        "C:\xampp\mysql\bin\mysql.exe"
    )
    foreach ($path in $candidates) {
        if (Test-Path $path) { return $path }
    }
    $cmd = Get-Command mysql -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    return $null
}

function Get-NetworkIPs {
    $ips = [System.Collections.Generic.List[string]]::new()
    try {
        Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
            Where-Object {
                $_.IPAddress -notmatch '^127\.' -and
                $_.IPAddress -notmatch '^169\.254\.' -and
                $_.PrefixOrigin -ne 'WellKnown'
            } |
            ForEach-Object { [void]$ips.Add($_.IPAddress) }
    } catch {
        [System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName()) |
            Where-Object { $_.AddressFamily -eq 'InterNetwork' -and $_.ToString() -notmatch '^127\.' } |
            ForEach-Object { [void]$ips.Add($_.ToString()) }
    }
    return @($ips | Select-Object -Unique)
}

function Invoke-MySql {
    param(
        [string]$MySqlExe,
        [string]$User,
        [string]$Password,
        [string]$Query,
        [string]$Database = ""
    )
    $env:MYSQL_PWD = $Password
    $mysqlArgs = @("--user=$User", "--host=localhost", "--batch", "--skip-column-names")
    if ($Database) { $mysqlArgs += $Database }
    $mysqlArgs += "-e", $Query
    $output = & $MySqlExe @mysqlArgs 2>&1
    Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue
    if ($LASTEXITCODE -ne 0) { throw ($output | Out-String) }
    return $output
}

Write-BannerLine
Write-Host "  Titan OEE - Starting Application" -ForegroundColor Cyan
Write-BannerLine
Write-Host ""

# [1/5] MySQL
Write-StepHeader 1 "Checking MySQL..."
$mysqlExe = Get-MySqlExe
$dbCreds = Get-DatabaseCredentials
if (-not $mysqlExe) {
    Write-StepFail "mysql.exe not found. Install MySQL 8.x and ensure it is on PATH."
    exit 1
}
try {
    $null = Invoke-MySql -MySqlExe $mysqlExe -User $dbCreds.User -Password $dbCreds.Password -Query "SELECT 1"
    Write-StepOk "MySQL running"
} catch {
    Write-StepFail "Cannot connect to MySQL. Start the MySQL service and check backend\.env"
    exit 1
}

# [2/5] Database
Write-StepHeader 2 "Setting up database..."
$venvPython = Join-Path $BackendDir "venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
    Write-Host "  Creating Python venv..." -ForegroundColor Yellow
    python -m venv (Join-Path $BackendDir "venv")
    & (Join-Path $BackendDir "venv\Scripts\pip.exe") install -r (Join-Path $BackendDir "requirements.txt")
}
$initScript = Join-Path $ProjectDir "database\init_database.ps1"
if (-not (Test-Path (Join-Path $ProjectDir "database\db.config.json"))) {
    Write-StepFail "database\db.config.json not found. Copy database\db.config.example.json and edit it."
    exit 1
}
try {
    & $initScript -ProjectDir $ProjectDir | Out-Host
    $dbCreds = Get-DatabaseCredentials
    $schema = $dbCreds.Database
    $escapedSchema = $schema.Replace("'", "''")
    $tableCount = Invoke-MySql -MySqlExe $mysqlExe -User $dbCreds.User -Password $dbCreds.Password `
        -Query "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$escapedSchema'"
    if ([int]$tableCount -lt 5) {
        Write-Host "  Database looks empty - run database\restore_from_package.ps1 to import package data" -ForegroundColor Yellow
    }
    Write-StepOk ("Database ready ({0}, {1} tables)" -f $schema, $tableCount)
} catch {
    Write-StepFail ("Database setup failed: {0}" -f $_.Exception.Message)
    Write-Host "  Tip: edit database\db.config.json or run database\setup_new_client.ps1" -ForegroundColor Yellow
    exit 1
}

# [3/5] Network + frontend env (Vite proxy mode for LAN access)
Write-StepHeader 3 "Configuring network..."
$networkIPs = Get-NetworkIPs
$frontendEnv = Join-Path $FrontendDir ".env"
$frontendEnvContent = @"
# Auto-generated by run.ps1 - Vite proxies /api and /ws to backend on port $BackendPort
VITE_API_URL=
VITE_WS_URL=
"@
[System.IO.File]::WriteAllText($frontendEnv, $frontendEnvContent, [System.Text.UTF8Encoding]::new($false))
if ($networkIPs.Count -eq 0) {
    Write-StepOk "Network configured (localhost only, Vite proxy enabled)"
} else {
    Write-StepOk ("Network configured ({0}, Vite proxy enabled)" -f ($networkIPs -join ', '))
}

# [4/5] Backend
Write-StepHeader 4 "Starting backend on port $BackendPort..."
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "cd '$BackendDir'; .\venv\Scripts\Activate.ps1; uvicorn app.main:app --host 0.0.0.0 --port $BackendPort --reload"
) -WindowStyle Normal
Start-Sleep -Seconds 3
$backendOk = $false
for ($i = 1; $i -le 30; $i++) {
    try {
        $null = Invoke-WebRequest -Uri "http://127.0.0.1:$BackendPort/health" -UseBasicParsing -TimeoutSec 2
        $backendOk = $true
        break
    } catch {
        Start-Sleep -Seconds 1
    }
}
if ($backendOk) {
    Write-StepOk "Backend running (dedicated PowerShell window)"
} else {
    Write-StepFail "Backend not responding on port $BackendPort"
    Write-Host "  Check the Backend PowerShell window for errors (MySQL connection, import errors)." -ForegroundColor Yellow
    exit 1
}

# [5/5] Frontend
Write-StepHeader 5 "Starting frontend on port $FrontendPort..."
$viteBin = Join-Path $FrontendDir "node_modules\.bin\vite.cmd"
if (-not (Test-Path $viteBin)) {
    Write-Host "  Installing frontend dependencies..." -ForegroundColor Yellow
    Push-Location $FrontendDir
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE" }
    Pop-Location
}
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "cd '$FrontendDir'; npm run dev"
) -WindowStyle Normal
Write-StepOk "Frontend running (dedicated PowerShell window)"

Write-Host ""
Write-BannerLine
Write-Host "  Titan OEE is running!" -ForegroundColor Green
Write-BannerLine
Write-Host ""
Write-Host "  Dashboard URLs:" -ForegroundColor White
Write-Host ("    -> Local  : http://localhost:{0}" -f $FrontendPort) -ForegroundColor Green
foreach ($ip in $networkIPs) {
    Write-Host ("    -> Network: http://{0}:{1}" -f $ip, $FrontendPort) -ForegroundColor Green
}
$apiHost = if ($networkIPs.Count -gt 0) { $networkIPs[0] } else { "localhost" }
Write-Host ("  API Docs  : http://{0}:{1}/docs" -f $apiHost, $BackendPort) -ForegroundColor Green
Write-Host ""
Write-Host "  Default login:  operator1 / op123" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Backend and frontend run in separate PowerShell windows." -ForegroundColor DarkGray
Write-Host "  Close those windows to stop the services." -ForegroundColor DarkGray
Write-Host "  Logs: watch output in the Backend / Frontend terminal windows." -ForegroundColor DarkGray
Write-Host ""
