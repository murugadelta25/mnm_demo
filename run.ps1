# Titan OEE + CPLM UI - Windows quick launcher
# Usage:
#   .\run.ps1
#   .\run.ps1 preflight
#   .\run.ps1 help
# Note: ASCII-only output for Windows PowerShell encoding compatibility

param(
    [string]$Action = "start"
)

$ErrorActionPreference = "Stop"
$ProjectDir = $PSScriptRoot
$BackendDir = Join-Path $ProjectDir "backend"
$FrontendDir = Join-Path $ProjectDir "frontend"
$BackendPort = 8010
$FrontendPort = 5174
$TotalSteps = 8

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

function Set-DomainHttps {
    param([bool]$Enabled)
    $path = Join-Path $ProjectDir "deploy\domain.config.json"
    $cfg = @{
        domain          = "din.eappms"
        lanIp           = ""
        dnsEnabled      = $true
        useHttps        = $Enabled
        autoGenerateSsl = $true
        sslCert         = "deploy/ssl/din.eappms.crt"
        sslKey          = "deploy/ssl/din.eappms.key"
    }
    if (Test-Path $path) {
        $raw = Get-Content $path -Raw | ConvertFrom-Json
        foreach ($name in @("domain", "lanIp", "dnsEnabled", "autoGenerateSsl", "sslCert", "sslKey")) {
            if ($null -ne $raw.PSObject.Properties[$name]) {
                $cfg[$name] = $raw.$name
            }
        }
    }
    $cfg.useHttps = $Enabled
    if (-not $cfg.sslCert) { $cfg.sslCert = "deploy/ssl/$($cfg.domain).crt" }
    if (-not $cfg.sslKey) { $cfg.sslKey = "deploy/ssl/$($cfg.domain).key" }
    $json = $cfg | ConvertTo-Json -Depth 5
    New-Item -ItemType Directory -Force -Path (Split-Path $path -Parent) | Out-Null
    [System.IO.File]::WriteAllText($path, $json + "`n", [System.Text.UTF8Encoding]::new($false))
}

function Prompt-HostMode {
    # Optional hosting mode: HTTP (default) or HTTPS.
    # Override without prompt: $env:USE_HTTPS = "true"|"t"|"false"|"f"
    $envVal = $env:USE_HTTPS
    if (-not [string]::IsNullOrWhiteSpace($envVal)) {
        $enabled = $envVal.Trim() -match '^(1|true|yes|y|t)$'
        Set-DomainHttps -Enabled:$enabled
        $mode = if ($enabled) { "HTTPS" } else { "HTTP" }
        Write-Host ("  Host mode from USE_HTTPS env: {0}" -f $mode) -ForegroundColor Cyan
        return $enabled
    }

    Write-Host ""
    Write-Host "  Hosting mode (other PCs on the LAN can open the portal either way):" -ForegroundColor Yellow
    Write-Host "    HTTP  - easy LAN access, no browser certificate warning (recommended for factory)" -ForegroundColor Gray
    Write-Host "    HTTPS - encrypted portal; self-signed cert may show a browser warning" -ForegroundColor Gray
    Write-Host "  Mobile PMS operator app keeps using http://<server-ip>:8010 (not affected)." -ForegroundColor DarkGray
    Write-Host ""
    $answer = Read-Host "  Enable HTTPS? Type t/true for HTTPS, or f/false/Enter for HTTP [f]"
    $enabled = $false
    if (-not [string]::IsNullOrWhiteSpace($answer)) {
        $enabled = $answer.Trim() -match '^(1|true|yes|y|t)$'
    }
    Set-DomainHttps -Enabled:$enabled
    if ($enabled) {
        Write-Host "  [OK] HTTPS enabled - standard URL will be https://din.eappms" -ForegroundColor Green
    } else {
        Write-Host "  [OK] HTTP mode - standard URL will be http://din.eappms" -ForegroundColor Green
    }
    return $enabled
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

function Show-Usage {
    Write-BannerLine
    Write-Host "  EAP PMS - Windows launcher" -ForegroundColor Cyan
    Write-BannerLine
    Write-Host ""
    Write-Host "Usage:" -ForegroundColor White
    Write-Host "  .\run.ps1           Start application" -ForegroundColor Gray
    Write-Host "  .\run.ps1 preflight Safe DB backup + schema checks only" -ForegroundColor Gray
    Write-Host "  .\run.ps1 help      Show this help" -ForegroundColor Gray
    Write-Host ""
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

function Get-MySqlDumpExe {
    $candidates = @(
        "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqldump.exe",
        "C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqldump.exe",
        "C:\xampp\mysql\bin\mysqldump.exe"
    )
    foreach ($path in $candidates) {
        if (Test-Path $path) { return $path }
    }
    $cmd = Get-Command mysqldump -ErrorAction SilentlyContinue
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

function Backup-Database {
    param(
        [string]$MySqlDumpExe,
        [hashtable]$DbCreds,
        [string]$ProjectDir
    )
    if (-not $MySqlDumpExe) {
        Write-Host "  [WARN] mysqldump not found - skipping preflight backup" -ForegroundColor Yellow
        return
    }
    $backupDir = Join-Path $ProjectDir "database\backups\preflight"
    New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
    $ts = Get-Date -Format "yyyyMMdd_HHmmss"
    $backupFile = Join-Path $backupDir ("{0}_preflight_{1}.sql" -f $DbCreds.Database, $ts)
    $env:MYSQL_PWD = $DbCreds.Password
    try {
        & $MySqlDumpExe "--user=$($DbCreds.User)" "--host=localhost" "--single-transaction" "--routines" "--triggers" $DbCreds.Database "--result-file=$backupFile" 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0 -and (Test-Path $backupFile)) {
            Write-StepOk ("Backup created: {0}" -f $backupFile)
        } else {
            Write-Host "  [WARN] Backup failed - continuing" -ForegroundColor Yellow
        }
    } finally {
        Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue
    }
}

function Get-FileHashHex {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return "" }
    return (Get-FileHash -Path $Path -Algorithm SHA256).Hash
}

function Test-VenvBelongsToProject {
    param([string]$VenvDir, [string]$ExpectedBackendDir)
    $cfg = Join-Path $VenvDir "pyvenv.cfg"
    if (-not (Test-Path $cfg)) { return $false }
    $raw = Get-Content $cfg -Raw
    # Reject venvs created for another project (common when folders were copied)
    if ($raw -match '(?im)^command\s*=\s*(.+)$') {
        $cmd = $Matches[1].Trim()
        $expectedNorm = [System.IO.Path]::GetFullPath($ExpectedBackendDir).TrimEnd('\')
        if ($cmd -and ($cmd -notlike "*$expectedNorm*")) {
            return $false
        }
    }
    $py = Join-Path $VenvDir "Scripts\python.exe"
    return (Test-Path $py)
}

function Ensure-BackendDependencies {
    # Prefer .venv (avoids locked legacy backend\venv from old runs / other projects)
    $venvDir = Join-Path $BackendDir ".venv"
    $legacyVenv = Join-Path $BackendDir "venv"
    $venvPython = Join-Path $venvDir "Scripts\python.exe"
    $reqFile = Join-Path $BackendDir "requirements.txt"
    $stampFile = Join-Path $venvDir ".requirements.sha256"
    $expectedBackend = [System.IO.Path]::GetFullPath($BackendDir)

    if (-not (Test-Path $reqFile)) {
        throw "backend\requirements.txt not found"
    }

    $py = Get-Command python -ErrorAction SilentlyContinue
    if (-not $py) { throw "python not found on PATH. Install Python 3.11+ and retry." }

    $venvOk = (Test-Path $venvPython) -and (Test-VenvBelongsToProject -VenvDir $venvDir -ExpectedBackendDir $expectedBackend)
    if (-not $venvOk) {
        if (Test-Path $venvDir) {
            Write-Host "  Replacing stale backend\.venv..." -ForegroundColor Yellow
            $bakName = ".venv.stale_{0}" -f (Get-Date -Format "yyyyMMdd_HHmmss")
            try {
                Rename-Item -Path $venvDir -NewName $bakName -ErrorAction Stop
            } catch {
                throw "backend\.venv is locked. Close Backend windows and retry. ($($_.Exception.Message))"
            }
        }
        Write-Host "  Creating Python venv for this project (backend\.venv)..." -ForegroundColor Yellow
        python -m venv $venvDir
        if (-not (Test-Path $venvPython)) { throw "Failed to create backend\.venv" }
        if (Test-Path $stampFile) { Remove-Item -Force $stampFile -ErrorAction SilentlyContinue }
    }

    if (Test-Path $legacyVenv) {
        Write-Host "  Note: legacy backend\venv ignored (using backend\.venv). You can delete backend\venv after closing old Backend windows." -ForegroundColor DarkGray
    }

    $reqHash = Get-FileHashHex -Path $reqFile
    $prevHash = if (Test-Path $stampFile) { (Get-Content $stampFile -Raw).Trim() } else { "" }
    $needInstall = ($reqHash -ne $prevHash)

    if (-not $needInstall) {
        $null = & $venvPython -c "import fastapi, uvicorn, cv2, numpy; print('ok')" 2>&1
        if ($LASTEXITCODE -ne 0) { $needInstall = $true }
    }

    if ($needInstall) {
        Write-Host "  Installing backend requirements.txt into backend\.venv..." -ForegroundColor Yellow
        & $venvPython -m pip install -r $reqFile | Out-Host
        if ($LASTEXITCODE -ne 0) { throw "pip install -r requirements.txt failed" }
        Set-Content -Path $stampFile -Value $reqHash -Encoding ASCII
        Write-StepOk "Backend Python packages installed"
    } else {
        Write-StepOk "Backend requirements already satisfied"
    }

    return $venvPython
}

function Ensure-FrontendDependencies {
    $pkgFile = Join-Path $FrontendDir "package.json"
    $lockFile = Join-Path $FrontendDir "package-lock.json"
    $nodeModules = Join-Path $FrontendDir "node_modules"
    $viteBin = Join-Path $FrontendDir "node_modules\.bin\vite.cmd"
    $stampFile = Join-Path $FrontendDir "node_modules\.package-lock.sha256"

    if (-not (Test-Path $pkgFile)) {
        throw "frontend\package.json not found"
    }

    $npm = Get-Command npm -ErrorAction SilentlyContinue
    if (-not $npm) { throw "npm not found on PATH. Install Node.js and retry." }

    $lockHash = if (Test-Path $lockFile) { Get-FileHashHex -Path $lockFile } else { Get-FileHashHex -Path $pkgFile }
    $prevHash = if (Test-Path $stampFile) { (Get-Content $stampFile -Raw).Trim() } else { "" }
    $needInstall = ($lockHash -ne $prevHash) -or (-not (Test-Path $viteBin)) -or (-not (Test-Path $nodeModules))

    if ($needInstall) {
        Write-Host "  Installing frontend npm packages..." -ForegroundColor Yellow
        Push-Location $FrontendDir
        try {
            npm install
            if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE" }
        } finally {
            Pop-Location
        }
        if (-not (Test-Path $nodeModules)) {
            throw "frontend\node_modules missing after npm install"
        }
        New-Item -ItemType Directory -Force -Path $nodeModules | Out-Null
        Set-Content -Path $stampFile -Value $lockHash -Encoding ASCII
        Write-StepOk "Frontend npm packages installed"
    } else {
        Write-StepOk "Frontend dependencies already satisfied"
    }
}

if ($Action -ieq "help" -or $Action -ieq "--help" -or $Action -ieq "-h") {
    Show-Usage
    exit 0
}

if (@("start", "preflight") -notcontains $Action.ToLowerInvariant()) {
    Write-StepFail ("Unknown action: {0}" -f $Action)
    Show-Usage
    exit 1
}

Write-BannerLine
Write-Host "  EAP PMS - Starting Application" -ForegroundColor Cyan
Write-BannerLine
Write-Host ""

# Host mode (HTTP vs HTTPS) - optional; default HTTP (start only)
if ($Action -ieq "start") {
    Write-StepHeader 0 "Choosing host mode (HTTP / HTTPS)..."
    $null = Prompt-HostMode
    Write-Host ""
}

# [1/8] Dependencies (always first)
Write-StepHeader 1 "Checking / installing dependencies..."
try {
    $venvPython = Ensure-BackendDependencies
    Ensure-FrontendDependencies
} catch {
    Write-StepFail ("Dependency setup failed: {0}" -f $_.Exception.Message)
    exit 1
}

# [2/8] MySQL
Write-StepHeader 2 "Checking MySQL..."
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

# [3/8] Database
Write-StepHeader 3 "Setting up database..."
if (-not (Test-Path $venvPython)) {
    Write-StepFail "backend\venv missing. Dependency step should have created it."
    exit 1
}
$initScript = Join-Path $ProjectDir "database\init_database.ps1"
if (-not (Test-Path (Join-Path $ProjectDir "database\db.config.json"))) {
    Write-StepFail "database\db.config.json not found. Copy database\db.config.example.json and edit it."
    exit 1
}
try {
    $mySqlDumpExe = Get-MySqlDumpExe
    Backup-Database -MySqlDumpExe $mySqlDumpExe -DbCreds $dbCreds -ProjectDir $ProjectDir
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
    Write-Host "  Running schema guard (web + mobile integration)..." -ForegroundColor Yellow
    Push-Location $BackendDir
    try {
        & $venvPython "ensure_schema.py" | Out-Host
        if ($LASTEXITCODE -ne 0) { throw "ensure_schema.py failed with exit code $LASTEXITCODE" }
    } finally {
        Pop-Location
    }
    Write-StepOk "Schema guard complete"
} catch {
    Write-StepFail ("Database setup failed: {0}" -f $_.Exception.Message)
    Write-Host "  Tip: edit database\db.config.json or run database\setup_new_client.ps1" -ForegroundColor Yellow
    exit 1
}

if ($Action -ieq "preflight") {
    Write-Host ""
    Write-BannerLine
    Write-Host "  Preflight complete" -ForegroundColor Green
    Write-BannerLine
    Write-Host ""
    Write-Host "  Verified dependencies, created DB backup if needed," -ForegroundColor White
    Write-Host "  applied migrations, and ran schema guard." -ForegroundColor White
    Write-Host ""
    Write-Host "  Next steps:" -ForegroundColor White
    Write-Host "    git pull" -ForegroundColor Green
    Write-Host "    .\run.ps1" -ForegroundColor Green
    exit 0
}

# [4/8] Network + frontend env (Vite proxy mode for LAN access)
Write-StepHeader 4 "Configuring network..."
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

# [5/8] Backend - always use this project's backend\venv
Write-StepHeader 5 "Starting backend on port $BackendPort..."

# Free port 8010 from stale uvicorn/--reload orphans (common cause of 502 Bad Gateway)
function Clear-PortListeners {
    param([int]$Port)
    $killed = @()
    try {
        $conns = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
        foreach ($c in $conns) {
            $procId = [int]$c.OwningProcess
            if ($procId -le 4) { continue }
            if ($killed -contains $procId) { continue }
            $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $procId" -ErrorAction SilentlyContinue
            $cmd = [string]$proc.CommandLine
            if ($cmd -match 'uvicorn|multiprocessing\.spawn|app\.main:app' -or -not $cmd) {
                Write-Host "  Clearing stale process on port $Port (PID $procId)..." -ForegroundColor Yellow
                Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
                $killed += $procId
            }
        }
    } catch { }
    # Orphaned --reload workers whose parent already died
    Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" -ErrorAction SilentlyContinue | Where-Object {
        $_.CommandLine -match "uvicorn app\.main:app|--multiprocessing-fork"
    } | ForEach-Object {
        if ($killed -contains $_.ProcessId) { return }
        Write-Host "  Stopping leftover uvicorn/python (PID $($_.ProcessId))..." -ForegroundColor Yellow
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        $killed += $_.ProcessId
    }
    if ($killed.Count -gt 0) { Start-Sleep -Seconds 2 }
}

Clear-PortListeners -Port $BackendPort

Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "cd '$BackendDir'; & '.\.venv\Scripts\Activate.ps1'; python -m uvicorn app.main:app --host 0.0.0.0 --port $BackendPort --reload"
) -WindowStyle Normal
Start-Sleep -Seconds 3
$backendOk = $false
for ($i = 1; $i -le 45; $i++) {
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
    Write-Host "  Tip: close old Backend windows, then: Get-NetTCPConnection -LocalPort $BackendPort" -ForegroundColor DarkGray
    exit 1
}

# [6/8] Frontend
Write-StepHeader 6 "Starting frontend on port $FrontendPort..."
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

# [7/8] nginx - standard URL din.eappms
Write-StepHeader 7 "Configuring standard URL (nginx reverse proxy)..."
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

# [8/8] LAN DNS - din.eappms for all devices on the network
Write-StepHeader 8 "Starting LAN DNS (network-wide din.eappms)..."
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
Write-Host ("    Then every device on WiFi/LAN opens {0} automatically" -f $domainCfg.Url) -ForegroundColor Yellow
Write-Host ""
Write-Host "  If router cannot be changed, per PC: deploy\Setup-Client-PC.bat (Admin)" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Default login:  operator1 / op123" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Backend and frontend run in separate PowerShell windows." -ForegroundColor DarkGray
if ($domainCfg.HttpsReady -or ($domainCfg.Scheme -eq "https")) {
    Write-Host "  nginx proxies HTTPS :443 (+ HTTP :80 redirects to HTTPS)." -ForegroundColor DarkGray
    Write-Host "  Certs: deploy\ssl\  (self-signed by default; replace with company CA for no browser warning)" -ForegroundColor DarkGray
} else {
    Write-Host "  nginx proxies port 80 (C:\ProgramData\EAP-PMS\nginx-win)." -ForegroundColor DarkGray
}
Write-Host "  Stop nginx: Stop-Process -Name nginx -Force -ErrorAction SilentlyContinue" -ForegroundColor DarkGray
Write-Host ""

try {
    if ($hostsReady) {
        Start-Process $domainCfg.Url
    } else {
        $openIp = if ($dnsCfg -and $dnsCfg.LanIp) { $dnsCfg.LanIp } else { Get-PrimaryLanIp -Ips $networkIPs -ProjectDir $ProjectDir }
        $openScheme = if ($domainCfg.Scheme) { $domainCfg.Scheme } else { "http" }
        Start-Process "${openScheme}://$openIp"
    }
} catch {
    # ignore if browser cannot open
}
