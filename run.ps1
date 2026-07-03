# Titan OEE + CPLM UI - Windows quick launcher
# Usage: .\run.ps1
# Note: ASCII-only output for Windows PowerShell encoding compatibility

$ErrorActionPreference = "Stop"
$ProjectDir = $PSScriptRoot
$BackendDir = Join-Path $ProjectDir "backend"
$FrontendDir = Join-Path $ProjectDir "frontend"
$BackendPort = 8010
$FrontendPort = 5174
$TotalSteps = 7

function Get-PrimaryLanIp {
    param([string[]]$Ips, [string]$ProjectDir)
    $cfgPath = Join-Path $ProjectDir "deploy\domain.config.json"
    if (Test-Path $cfgPath) {
        $lan = (Get-Content $cfgPath -Raw | ConvertFrom-Json).lanIp
        if ($lan) { return [string]$lan }
    }
    $pref = $Ips | Where-Object { $_ -match '^10\.151\.' } | Select-Object -First 1
    if ($pref) { return $pref }
    if ($Ips.Count -gt 0) { return $Ips[0] }
    return "127.0.0.1"
}

function Get-DomainConfig {
    $path = Join-Path $ProjectDir "deploy\domain.config.json"
    $domain = "din.eappms"
    $useHttps = $false
    if (Test-Path $path) {
        $raw = Get-Content $path -Raw | ConvertFrom-Json
        if ($raw.domain) { $domain = [string]$raw.domain }
        if ($raw.useHttps -eq $true) { $useHttps = $true }
    }
    $scheme = if ($useHttps) { "https" } else { "http" }
    return @{
        Domain   = $domain
        Scheme   = $scheme
        Url      = "${scheme}://${domain}"
    }
}

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
Write-Host "  EAP PMS - Starting Application" -ForegroundColor Cyan
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

# [5/6] Frontend
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
Start-Sleep -Seconds 3
$frontendOk = $false
for ($i = 1; $i -le 30; $i++) {
    try {
        $null = Invoke-WebRequest -Uri "http://127.0.0.1:$FrontendPort" -UseBasicParsing -TimeoutSec 2
        $frontendOk = $true
        break
    } catch {
        Start-Sleep -Seconds 1
    }
}
if ($frontendOk) {
    Write-StepOk "Frontend running (dedicated PowerShell window)"
} else {
    Write-StepFail "Frontend not responding on port $FrontendPort"
    exit 1
}

# [6/7] nginx — standard URL din.eappms
Write-StepHeader 6 "Configuring standard URL (nginx reverse proxy)..."
$domainCfg = $null
try {
    $domainCfg = & (Join-Path $ProjectDir "scripts\Install-Nginx.ps1") -ProjectDir $ProjectDir -BackendPort $BackendPort -FrontendPort $FrontendPort
    Write-StepOk ("Standard URL ready: {0}" -f $domainCfg.Url)
} catch {
    Write-StepFail ("nginx setup failed: {0}" -f $_.Exception.Message)
    Write-Host "  Tip: run PowerShell as Administrator (port 80 + hosts file). Direct URLs on :5174 still work." -ForegroundColor Yellow
    $domainCfg = Get-DomainConfig
}

$hostsReady = $false
if ($domainCfg -and $domainCfg.HostsRegistered) {
    $hostsReady = $true
}

# [7/7] LAN DNS — din.eappms for all devices on the network
Write-StepHeader 7 "Starting LAN DNS (network-wide din.eappms)..."
$dnsCfg = $null
$prevEaDns = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$primaryIp = Get-PrimaryLanIp -Ips $networkIPs -ProjectDir $ProjectDir
$dnsCfg = & (Join-Path $ProjectDir "scripts\Install-LocalDns.ps1") -ProjectDir $ProjectDir -LanIp $primaryIp
$ErrorActionPreference = $prevEaDns

if ($dnsCfg -and $dnsCfg.DnsEnabled -eq $true) {
    Write-StepOk ("LAN DNS: {0} (current IPC IP {1})" -f $dnsCfg.Domain, $dnsCfg.LanIp)
} elseif ($dnsCfg -and $dnsCfg.DnsEnabled -eq $false) {
    Write-Host "  [SKIP] LAN DNS not started (dnslib or port 53)" -ForegroundColor Yellow
    Write-Host "  Tip: din.eappms still works on this PC. For other PCs use deploy\Setup-Client-PC.bat" -ForegroundColor DarkGray
} else {
    Write-StepFail "LAN DNS failed unexpectedly"
    Write-Host "  Tip: run .\scripts\Install-LocalDns.ps1 manually, or use deploy\Setup-Client-PC.bat per PC" -ForegroundColor Yellow
}

Write-Host ""
Write-BannerLine
Write-Host "  EAP PMS is running!" -ForegroundColor Green
Write-BannerLine
Write-Host ""
if (-not $domainCfg) { $domainCfg = Get-DomainConfig }
if (-not $hostsReady) {
    Write-Host "  *** http://din.eappms will NOT work on this PC yet ***" -ForegroundColor Red
    Write-Host "  Cause: hosts file was not updated (run.ps1 was not Administrator)." -ForegroundColor Yellow
    Write-Host "  Fix (30 seconds):" -ForegroundColor Yellow
    Write-Host "    Right-click deploy\Setup-Server-Host.bat -> Run as administrator" -ForegroundColor White
    Write-Host "  Or re-run: Right-click PowerShell -> Run as administrator -> .\run.ps1" -ForegroundColor White
    Write-Host ""
}
Write-Host "  Standard URL (use this):" -ForegroundColor White
Write-Host ("    -> {0}" -f $domainCfg.Url) -ForegroundColor Green
Write-Host ("  API Docs  : {0}/docs" -f $domainCfg.Url) -ForegroundColor Green
Write-Host ""
Write-Host "  Direct access (fallback):" -ForegroundColor White
Write-Host ("    -> Local  : http://localhost:{0}" -f $FrontendPort) -ForegroundColor DarkGray
foreach ($ip in $networkIPs) {
    Write-Host ("    -> Network (port 80) : http://{0}" -f $ip) -ForegroundColor Green
    Write-Host ("    -> Network (Vite)    : http://{0}:{1}" -f $ip, $FrontendPort) -ForegroundColor DarkGray
}
Write-Host ""
$primaryIp = if ($dnsCfg -and $dnsCfg.LanIp) { $dnsCfg.LanIp } else { Get-PrimaryLanIp -Ips $networkIPs -ProjectDir $ProjectDir }
Write-Host "  Network access (Windows / Ubuntu / Android):" -ForegroundColor White
Write-Host ("    Standard URL : {0}" -f $domainCfg.Url) -ForegroundColor Green
Write-Host ("    Primary IP   : {0}  (use http://{0} if DNS not set up)" -f $primaryIp) -ForegroundColor Green
Write-Host "    Any listed Network IP on port 80 works - no hostname required." -ForegroundColor DarkGray
Write-Host ""
Write-Host "  If the IPC IP changes (DHCP):" -ForegroundColor Yellow
Write-Host "    - Direct http://<new-ip> still works (nginx listens on all interfaces)" -ForegroundColor Yellow
Write-Host "    - LAN DNS auto-updates din.eappms every 30s (restart run.ps1 after network change)" -ForegroundColor Yellow
Write-Host "    - Router DHCP DNS must point to the IPC server IP (use static DHCP for IPC in production)" -ForegroundColor Yellow
Write-Host ""
Write-Host "  ONE-TIME IT / router setup (enables PC + Android + tablets):" -ForegroundColor Yellow
Write-Host ("    Set DHCP DNS server to: {0}" -f $primaryIp) -ForegroundColor Yellow
Write-Host "    Then every device on WiFi/LAN opens http://din.eappms automatically" -ForegroundColor Yellow
Write-Host ""
Write-Host "  If router cannot be changed, per PC: deploy\Setup-Client-PC.bat (Admin)" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Default login:  operator1 / op123" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Backend and frontend run in separate PowerShell windows." -ForegroundColor DarkGray
Write-Host "  nginx proxies port 80 (C:\ProgramData\EAP-PMS\nginx-win)." -ForegroundColor DarkGray
Write-Host "  Stop nginx: Stop-Process -Name nginx -Force -ErrorAction SilentlyContinue" -ForegroundColor DarkGray
Write-Host ""

try {
    if ($hostsReady) {
        Start-Process $domainCfg.Url
    } else {
        $openIp = if ($dnsCfg -and $dnsCfg.LanIp) { $dnsCfg.LanIp } else { Get-PrimaryLanIp -Ips $networkIPs -ProjectDir $ProjectDir }
        Start-Process "http://$openIp"
    }
} catch {
    # ignore if browser cannot open
}
