# Configure nginx reverse proxy for din.eappms (Windows)
# nginx is installed under %ProgramData%\EAP-PMS\nginx-win (no spaces in path).
# When deploy/domain.config.json has useHttps=true, also listens on 443 with TLS.
param(
    [string]$ProjectDir = (Split-Path $PSScriptRoot -Parent),
    [int]$BackendPort = 8010,
    [int]$FrontendPort = 5174
)

$ErrorActionPreference = "Stop"

$script:NginxRoot = Join-Path $env:ProgramData "EAP-PMS\nginx-win"

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Test-NginxPrefixWritable {
    param([string]$Prefix)
    $confDir = Join-Path $Prefix "conf"
    New-Item -ItemType Directory -Force -Path $confDir | Out-Null
    $probe = Join-Path $confDir ".write_probe"
    try {
        [System.IO.File]::WriteAllText($probe, "ok", [System.Text.UTF8Encoding]::new($false))
        Remove-Item $probe -Force -ErrorAction SilentlyContinue
        return $true
    } catch {
        return $false
    }
}

function Repair-NginxPrefixAcl {
    param([string]$Prefix)
    if (-not (Test-IsAdministrator)) { return $false }
    New-Item -ItemType Directory -Force -Path $Prefix | Out-Null
    $user = "$env:USERDOMAIN\$env:USERNAME"
    & icacls $Prefix /grant "Administrators:(OI)(CI)F" /T 2>$null | Out-Null
    & icacls $Prefix /grant "${user}:(OI)(CI)M" /T 2>$null | Out-Null
    & icacls $Prefix /grant "Users:(OI)(CI)M" /T 2>$null | Out-Null
    return (Test-NginxPrefixWritable -Prefix $Prefix)
}

function Clear-NginxConfReadOnly {
    param([string]$Prefix)
    $confFile = Join-Path $Prefix "conf\nginx.conf"
    if (Test-Path $confFile) {
        attrib -R $confFile 2>$null | Out-Null
    }
}

function Write-NginxStep {
    param([string]$Message)
    Write-Host "  $Message" -ForegroundColor DarkGray
}

function Resolve-SslPath {
    param([string]$PathValue, [string]$Root)
    if ([string]::IsNullOrWhiteSpace($PathValue)) { return $null }
    if ([System.IO.Path]::IsPathRooted($PathValue)) { return $PathValue }
    return [System.IO.Path]::GetFullPath((Join-Path $Root $PathValue))
}

function Get-DomainConfig {
    param([string]$Root)
    $path = Join-Path $Root "deploy\domain.config.json"
    $domain = "din.eappms"
    $useHttps = $false
    $autoSsl = $true
    $sslCert = "deploy/ssl/din.eappms.crt"
    $sslKey = "deploy/ssl/din.eappms.key"
    if (Test-Path $path) {
        $raw = Get-Content $path -Raw | ConvertFrom-Json
        if ($raw.domain) { $domain = [string]$raw.domain }
        if ($raw.useHttps -eq $true) { $useHttps = $true }
        if ($null -ne $raw.PSObject.Properties['autoGenerateSsl']) {
            $autoSsl = [bool]$raw.autoGenerateSsl
        } else {
            $autoSsl = $useHttps
        }
        if ($raw.sslCert) { $sslCert = [string]$raw.sslCert }
        if ($raw.sslKey) { $sslKey = [string]$raw.sslKey }
        if (-not $raw.sslCert) { $sslCert = "deploy/ssl/$domain.crt" }
        if (-not $raw.sslKey) { $sslKey = "deploy/ssl/$domain.key" }
    }
    $certFull = Resolve-SslPath -PathValue $sslCert -Root $Root
    $keyFull = Resolve-SslPath -PathValue $sslKey -Root $Root
    $httpsReady = $useHttps -and (Test-Path $certFull) -and (Test-Path $keyFull)
    # Scheme reflects intended config; Url uses https only when certs are ready.
    $scheme = if ($httpsReady) { "https" } elseif ($useHttps) { "https" } else { "http" }
    return @{
        Domain       = $domain
        UseHttps     = $useHttps
        AutoGenerateSsl = $autoSsl
        SslCert      = $certFull
        SslKey       = $keyFull
        HttpsReady   = $httpsReady
        Scheme       = $scheme
        Url          = "${scheme}://${domain}"
    }
}

function Get-LanIpList {
    try {
        return @(
            Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
                Where-Object {
                    $_.IPAddress -notmatch '^127\.' -and
                    $_.IPAddress -notmatch '^169\.254\.'
                } |
                Select-Object -ExpandProperty IPAddress -Unique
        )
    } catch {
        return @()
    }
}

function Test-CertCoversIps {
    param([string]$CertPath, [string[]]$Ips)
    if (-not $Ips -or $Ips.Count -eq 0) { return $true }
    try {
        $dump = & certutil -dump $CertPath 2>&1 | Out-String
    } catch {
        return $true
    }
    foreach ($ip in $Ips) {
        if ($dump -notmatch [regex]::Escape("IP Address=$ip")) { return $false }
    }
    return $true
}

function Ensure-SslCertificates {
    param([hashtable]$DomainCfg, [string]$Root)
    if (-not $DomainCfg.UseHttps) { return $DomainCfg }
    $lanIps = Get-LanIpList
    if ((Test-Path $DomainCfg.SslCert) -and (Test-Path $DomainCfg.SslKey)) {
        # A self-signed cert must list the current LAN IPs, otherwise https://<ip>
        # fails name validation after a DHCP address change.
        $reuse = $true
        if ($DomainCfg.AutoGenerateSsl -and -not (Test-CertCoversIps -CertPath $DomainCfg.SslCert -Ips $lanIps)) {
            Write-NginxStep "Existing cert does not cover current LAN IP(s) - regenerating..."
            $reuse = $false
        }
        if ($reuse) {
            $DomainCfg.HttpsReady = $true
            $DomainCfg.Scheme = "https"
            $DomainCfg.Url = "https://$($DomainCfg.Domain)"
            return $DomainCfg
        }
    }
    if (-not $DomainCfg.AutoGenerateSsl) {
        Write-Host "  [WARN] useHttps is true but certs missing and autoGenerateSsl is false" -ForegroundColor Yellow
        $DomainCfg.HttpsReady = $false
        $DomainCfg.Scheme = "http"
        $DomainCfg.Url = "http://$($DomainCfg.Domain)"
        return $DomainCfg
    }

    Write-NginxStep "Generating self-signed TLS certificate for $($DomainCfg.Domain)..."
    $certDir = Split-Path $DomainCfg.SslCert -Parent
    New-Item -ItemType Directory -Force -Path $certDir | Out-Null

    $pyCandidates = @(
        (Join-Path $Root "backend\.venv\Scripts\python.exe"),
        (Join-Path $Root "backend\venv\Scripts\python.exe"),
        "python",
        "py"
    )
    $py = $null
    foreach ($c in $pyCandidates) {
        if ($c -eq "python" -or $c -eq "py") {
            $cmd = Get-Command $c -ErrorAction SilentlyContinue
            if ($cmd) { $py = $cmd.Source; break }
        } elseif (Test-Path $c) {
            $py = $c
            break
        }
    }
    if (-not $py) {
        Write-Host "  [WARN] Python not found - cannot auto-generate SSL cert" -ForegroundColor Yellow
        $DomainCfg.HttpsReady = $false
        $DomainCfg.Scheme = "http"
        $DomainCfg.Url = "http://$($DomainCfg.Domain)"
        return $DomainCfg
    }

    $genScript = Join-Path $Root "scripts\generate_ssl_cert.py"
    if (-not (Test-Path $genScript)) {
        Write-Host "  [WARN] SSL generator missing: $genScript" -ForegroundColor Yellow
        Write-Host "  [INFO] Restore scripts\generate_ssl_cert.py from the EAP PMS repo, then re-run." -ForegroundColor DarkGray
        $DomainCfg.HttpsReady = $false
        $DomainCfg.Scheme = "http"
        $DomainCfg.Url = "http://$($DomainCfg.Domain)"
        return $DomainCfg
    }
    # Reached only when certs are missing or no longer match the LAN IPs,
    # so --force is required to replace a stale file.
    # Invoked via the Python interpreter (not as an executable).
    $genArgs = @(
        $genScript,
        "--cert", $DomainCfg.SslCert,
        "--key", $DomainCfg.SslKey,
        "--cn", $DomainCfg.Domain,
        "--force"
    )
    foreach ($ip in $lanIps) {
        $genArgs += @("--san-ip", $ip)
    }
    $genOut = & $py @genArgs 2>&1 | Out-String
    $genRc = $LASTEXITCODE
    if ($genRc -ne 0 -or -not (Test-Path $DomainCfg.SslCert) -or -not (Test-Path $DomainCfg.SslKey)) {
        Write-Host "  [WARN] SSL cert generation failed - falling back to HTTP" -ForegroundColor Yellow
        Write-Host "  [INFO] Python: $py" -ForegroundColor DarkGray
        Write-Host "  [INFO] Script: $genScript" -ForegroundColor DarkGray
        if (-not [string]::IsNullOrWhiteSpace($genOut)) {
            Write-Host "  [INFO] Generator output:" -ForegroundColor DarkGray
            foreach ($line in ($genOut -split "`r?`n")) {
                if (-not [string]::IsNullOrWhiteSpace($line)) {
                    Write-Host "         $line" -ForegroundColor DarkGray
                }
            }
        }
        $DomainCfg.HttpsReady = $false
        $DomainCfg.Scheme = "http"
        $DomainCfg.Url = "http://$($DomainCfg.Domain)"
        return $DomainCfg
    }

    Write-Host "  [OK] Self-signed cert ready: $($DomainCfg.SslCert)" -ForegroundColor Green
    Write-Host "  [INFO] Browsers will warn until this cert (or a company CA) is trusted" -ForegroundColor Yellow
    $DomainCfg.HttpsReady = $true
    $DomainCfg.Scheme = "https"
    $DomainCfg.Url = "https://$($DomainCfg.Domain)"
    return $DomainCfg
}

function Get-ProxyLocations {
    param([int]$BackendPort, [int]$FrontendPort)
    return @"
    client_max_body_size 25M;

    location /api/archive/ {
        client_max_body_size 512M;
        proxy_pass http://127.0.0.1:$BackendPort;
        proxy_http_version 1.1;
        proxy_set_header Host `$host;
        proxy_set_header X-Real-IP `$remote_addr;
        proxy_set_header X-Forwarded-For `$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto `$scheme;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
        proxy_request_buffering off;
    }

    location / {
        proxy_pass http://127.0.0.1:$FrontendPort;
        proxy_http_version 1.1;
        proxy_set_header Host `$host;
        proxy_set_header X-Real-IP `$remote_addr;
        proxy_set_header X-Forwarded-For `$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto `$scheme;
        proxy_set_header Upgrade `$http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    location /api/ {
        proxy_pass http://127.0.0.1:$BackendPort;
        proxy_http_version 1.1;
        proxy_set_header Host `$host;
        proxy_set_header X-Real-IP `$remote_addr;
        proxy_set_header X-Forwarded-For `$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto `$scheme;
        proxy_read_timeout 120s;
    }

    location /ws {
        proxy_pass http://127.0.0.1:$BackendPort;
        proxy_http_version 1.1;
        proxy_set_header Upgrade `$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host `$host;
        proxy_read_timeout 86400;
    }

    location /static/ {
        proxy_pass http://127.0.0.1:$BackendPort;
        proxy_set_header Host `$host;
    }

    location /health {
        proxy_pass http://127.0.0.1:$BackendPort;
    }

    location /docs {
        proxy_pass http://127.0.0.1:$BackendPort;
    }

    location /openapi.json {
        proxy_pass http://127.0.0.1:$BackendPort;
    }
"@
}

function Ensure-NginxWin {
    param(
        [string]$TargetDir,
        [string]$ProjectDir
    )
    $nginxExe = Join-Path $TargetDir "nginx.exe"
    if (Test-Path $nginxExe) { return $nginxExe }

    $legacyDir = Join-Path $ProjectDir "deploy\nginx-win"
    if (Test-Path (Join-Path $legacyDir "nginx.exe")) {
        Write-NginxStep "Copying nginx to $TargetDir ..."
        New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
        Copy-Item -Path (Join-Path $legacyDir "*") -Destination $TargetDir -Recurse -Force
        if (Test-Path $nginxExe) { return $nginxExe }
    }

    Write-Host "  Downloading nginx for Windows (one-time)..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
    $zipUrl = "https://nginx.org/download/nginx-1.24.0.zip"
    $zipPath = Join-Path $env:TEMP "nginx-1.24.0.zip"
    $extractRoot = Join-Path $env:TEMP "nginx-dl"
    Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
    if (Test-Path $extractRoot) { Remove-Item $extractRoot -Recurse -Force }
    Expand-Archive -Path $zipPath -DestinationPath $extractRoot -Force
    $extracted = Get-ChildItem $extractRoot -Directory | Select-Object -First 1
    Copy-Item -Path (Join-Path $extracted.FullName "*") -Destination $TargetDir -Recurse -Force
    Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
    Remove-Item $extractRoot -Recurse -Force -ErrorAction SilentlyContinue
    return $nginxExe
}

function Write-NginxConf {
    param(
        [string]$NginxPrefix,
        [hashtable]$DomainCfg,
        [int]$BackendPort,
        [int]$FrontendPort
    )
    $confDir = Join-Path $NginxPrefix "conf"
    New-Item -ItemType Directory -Force -Path $confDir | Out-Null
    $domain = $DomainCfg.Domain
    $locations = Get-ProxyLocations -BackendPort $BackendPort -FrontendPort $FrontendPort

    # Keep TLS files under the nginx prefix (no spaces) so ssl_* paths are safe on Windows.
    $certNginx = ""
    $keyNginx = ""
    if ($DomainCfg.HttpsReady) {
        $sslDir = Join-Path $NginxPrefix "ssl"
        New-Item -ItemType Directory -Force -Path $sslDir | Out-Null
        $certLocal = Join-Path $sslDir "din.eappms.crt"
        $keyLocal = Join-Path $sslDir "din.eappms.key"
        Copy-Item -Force -Path $DomainCfg.SslCert -Destination $certLocal
        Copy-Item -Force -Path $DomainCfg.SslKey -Destination $keyLocal
        # Quoted + forward slashes: required when any path segment has spaces.
        $certNginx = '"' + (($certLocal -replace '\\', '/')) + '"'
        $keyNginx = '"' + (($keyLocal -replace '\\', '/')) + '"'
    }

    if ($DomainCfg.HttpsReady) {
        $serverBlock = @"
server {
    listen       80;
    server_name  $domain _;
    return 301 https://`$host`$request_uri;
}

server {
    listen       443 ssl;
    server_name  $domain _;

    ssl_certificate      $certNginx;
    ssl_certificate_key  $keyNginx;

$locations
}
"@
    } else {
        $serverBlock = @"
server {
    listen       80;
    server_name  $domain _;

$locations
}
"@
    }

    $mainConf = @"
worker_processes  1;
error_log  logs/error.log;
pid        logs/nginx.pid;

events {
    worker_connections  1024;
}

http {
    include       mime.types;
    default_type  application/octet-stream;
    sendfile        on;
    keepalive_timeout  65;
    $serverBlock
}
"@
    $confFile = Join-Path $confDir "nginx.conf"
    try {
        [System.IO.File]::WriteAllText($confFile, $mainConf, [System.Text.UTF8Encoding]::new($false))
    } catch {
        Clear-NginxConfReadOnly -Prefix $NginxPrefix
        if (Repair-NginxPrefixAcl -Prefix $NginxPrefix) {
            [System.IO.File]::WriteAllText($confFile, $mainConf, [System.Text.UTF8Encoding]::new($false))
        } else {
            throw
        }
    }
}

function Ensure-HostsEntry {
    param([string]$Domain, [string]$Ip = "127.0.0.1")
    $hostsPath = "$env:SystemRoot\System32\drivers\etc\hosts"
    $lines = @(Get-Content $hostsPath -ErrorAction SilentlyContinue)
    $escaped = [regex]::Escape($Domain)
    $filtered = $lines | Where-Object { $_ -notmatch "\s$escaped(\s|$)" }
    try {
        ($filtered + @("", "# EAP PMS IPC server (run.ps1)", "$Ip`t$Domain")) | Set-Content -Path $hostsPath -Encoding ASCII -ErrorAction Stop
        Write-Host "  [OK] Added hosts entry: $Ip $Domain" -ForegroundColor Green
        return $true
    } catch {
        Write-Host "  [WARN] Could not update hosts file - run PowerShell as Administrator" -ForegroundColor Yellow
        Write-Host "  [WARN] Or on other PCs run: scripts\Register-ClientHost.ps1 -ServerIp <ipc-ip>" -ForegroundColor Yellow
        return $false
    }
}

function Ensure-NginxDirs {
    param([string]$Prefix)
    foreach ($sub in @('logs', 'temp', 'html')) {
        New-Item -ItemType Directory -Force -Path (Join-Path $Prefix $sub) | Out-Null
    }
}

function Stop-NginxInstance {
    param([string]$Exe, [string]$Prefix)
    $pidFile = Join-Path $Prefix "logs\nginx.pid"
    if (-not (Test-Path $pidFile)) { return }
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        Start-Process -FilePath $Exe -ArgumentList @('-p', $Prefix, '-s', 'quit') -WorkingDirectory $Prefix -WindowStyle Hidden -Wait
        Start-Sleep -Seconds 1
    } catch {
        # ignore stale pid
    } finally {
        $ErrorActionPreference = $prev
    }
}

function Start-NginxInstance {
    param([string]$Exe, [string]$Prefix)
    # Validate config before start so emerg errors are clear.
    $test = & $Exe -p $Prefix -t 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) {
        throw "nginx config test failed: $test"
    }
    Start-Process -FilePath $Exe -ArgumentList @('-p', $Prefix) -WorkingDirectory $Prefix -WindowStyle Hidden
    Start-Sleep -Seconds 2
}

function Test-NginxListening {
    param([int]$Port = 80)
    try {
        $r = Test-NetConnection -ComputerName 127.0.0.1 -Port $Port -WarningAction SilentlyContinue
        return $r.TcpTestSucceeded
    } catch {
        return $false
    }
}

function Open-FirewallPorts {
    param([bool]$Https)
    $rules = @(
        @{ Name = "EAP PMS nginx HTTP 80"; Port = 80 }
    )
    if ($Https) {
        $rules += @{ Name = "EAP PMS nginx HTTPS 443"; Port = 443 }
    }
    foreach ($rule in $rules) {
        $existing = Get-NetFirewallRule -DisplayName $rule.Name -ErrorAction SilentlyContinue
        if (-not $existing) {
            try {
                New-NetFirewallRule -DisplayName $rule.Name -Direction Inbound -Protocol TCP -LocalPort $rule.Port -Action Allow | Out-Null
                Write-Host "  [OK] Firewall rule added for TCP $($rule.Port)" -ForegroundColor Green
            } catch {
                Write-Host "  [WARN] Could not add firewall rule for port $($rule.Port) (Administrator?)" -ForegroundColor Yellow
            }
        }
    }
}

Write-NginxStep "Using nginx root: $script:NginxRoot"
$domainCfg = Get-DomainConfig -Root $ProjectDir
$domainCfg = Ensure-SslCertificates -DomainCfg $domainCfg -Root $ProjectDir

if (-not (Test-IsAdministrator)) {
    Write-Host "  [WARN] Not running as Administrator - nginx needs port 80/443 and hosts file access." -ForegroundColor Yellow
    Write-Host "  [WARN] Right-click PowerShell -> Run as administrator, then: .\run.ps1" -ForegroundColor Yellow
    Write-Host "  [WARN] Or: deploy\Setup-Server-Host.bat (Run as administrator)" -ForegroundColor Yellow
    if (-not (Test-NginxPrefixWritable -Prefix $script:NginxRoot)) {
        throw "Cannot write nginx config under $script:NginxRoot (access denied). Run as Administrator once to fix permissions."
    }
}

Write-NginxStep "Ensuring nginx binaries..."
$nginxExe = Ensure-NginxWin -TargetDir $script:NginxRoot -ProjectDir $ProjectDir
if (-not (Test-Path $nginxExe)) {
    throw "nginx.exe not found at $nginxExe"
}

if (-not (Test-NginxPrefixWritable -Prefix $script:NginxRoot)) {
    Write-NginxStep "Repairing nginx folder permissions..."
    if (-not (Repair-NginxPrefixAcl -Prefix $script:NginxRoot)) {
        throw "Cannot write to $script:NginxRoot - run PowerShell as Administrator."
    }
}

Ensure-NginxDirs -Prefix $script:NginxRoot

Write-NginxStep "Stopping previous nginx instance (if any)..."
Stop-NginxInstance -Exe $nginxExe -Prefix $script:NginxRoot
Clear-NginxConfReadOnly -Prefix $script:NginxRoot

Write-NginxStep "Writing nginx.conf..."
Write-NginxConf -NginxPrefix $script:NginxRoot -DomainCfg $domainCfg -BackendPort $BackendPort -FrontendPort $FrontendPort

$listenMsg = if ($domainCfg.HttpsReady) { "ports 80 (redirect) + 443 (HTTPS)" } else { "port 80 (HTTP)" }
Write-NginxStep "Starting nginx on $listenMsg..."
Start-NginxInstance -Exe $nginxExe -Prefix $script:NginxRoot

$nginxProc = Get-Process -Name nginx -ErrorAction SilentlyContinue
$portOpen = Test-NginxListening -Port 80
$httpsOpen = $false
if ($domainCfg.HttpsReady) {
    $httpsOpen = Test-NginxListening -Port 443
}
if (-not $nginxProc -and -not $portOpen) {
    $errLog = Join-Path $script:NginxRoot "logs\error.log"
    $tail = ""
    if (Test-Path $errLog) {
        $recent = Get-Content $errLog -Tail 40 -ErrorAction SilentlyContinue |
            Where-Object { $_ -match '\[emerg\]|\[alert\]|bind\(\)|ssl_certificate' }
        if (-not $recent) {
            $recent = Get-Content $errLog -Tail 5 -ErrorAction SilentlyContinue
        }
        $tail = ($recent | Select-Object -Last 5) -join " | "
    }
    throw "nginx failed to start (is port 80/443 in use?). $tail Log: $errLog"
}
if ($domainCfg.HttpsReady -and -not $httpsOpen) {
    Write-Host "  [WARN] HTTPS port 443 not listening yet - check nginx error.log" -ForegroundColor Yellow
}

Write-NginxStep "Registering hosts entry..."
$hostsRegistered = Ensure-HostsEntry -Domain $domainCfg.Domain -Ip "127.0.0.1"
$domainCfg.HostsRegistered = $hostsRegistered
Open-FirewallPorts -Https:$domainCfg.HttpsReady

Write-Host "  [OK] nginx proxy active - $($domainCfg.Url)" -ForegroundColor Green
if ($domainCfg.HttpsReady) {
    Write-Host "  [OK] HTTPS enabled (self-signed or configured cert)" -ForegroundColor Green
}
Write-Host "  [OK] nginx root: $script:NginxRoot" -ForegroundColor DarkGray
return $domainCfg
