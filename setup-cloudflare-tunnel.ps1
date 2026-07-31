# Rocky Da Adda — Cloudflare Tunnel setup (Windows)
#
# Run this ONCE, as Administrator, on the Windows machine that's actually
# running the app (i.e. after install.ps1 — http://localhost:3000 should
# already be answering before you run this). It routes pollys.food and
# www.pollys.food through a Cloudflare Tunnel straight to this machine's
# port 3000 — no router port-forwarding needed, since the tunnel is an
# outbound connection from this machine to Cloudflare.
#
# WARNING: this overwrites the existing DNS records for pollys.food and
# www.pollys.food to point at this tunnel instead of wherever they
# currently point (e.g. the old clawdbot box). Only run this once the app
# is confirmed working locally — traffic can start arriving as soon as DNS
# propagates and the service below is running.
#
# Requires: a Cloudflare account with the pollys.food zone already added.
# `cloudflared login` (step below) opens a browser for you to authorize —
# you'll need to log in and approve the pollys.food zone there.
#
# Background on why this is more involved than a normal install: the
# Cloudflare Tunnel runs as a Windows SERVICE (so it survives reboots
# without anyone logged in), and Windows services run as the SYSTEM
# account — a completely different profile from your own user account.
# So the login/tunnel-creation steps (which write credentials to *your*
# profile) have their credentials copied into SYSTEM's profile afterward,
# which is where the service actually looks for them.

param(
    [string]$TunnelName = "rockyda-windows",
    [string[]]$Hostnames = @("pollys.food", "www.pollys.food"),
    [int]$LocalPort = 3000
)

$ErrorActionPreference = 'Stop'

function Write-Step { Write-Host "`n► $args" -ForegroundColor Green }
function Write-Warn { Write-Host "  $args" -ForegroundColor Yellow }
function Write-OK   { Write-Host "  ✓ $args" -ForegroundColor Cyan }

$IsAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $IsAdmin) {
    throw "Run this script from an elevated (Administrator) PowerShell — right-click PowerShell -> Run as administrator."
}

$BinDir = "C:\Cloudflared\bin"
$CloudflaredExe = Join-Path $BinDir "cloudflared.exe"
$UserCfDir = Join-Path $env:USERPROFILE ".cloudflared"
$SystemCfDir = "C:\Windows\System32\config\systemprofile\.cloudflared"

# ── Download cloudflared ─────────────────────────────────────────────────────

Write-Step "Downloading cloudflared"
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
if (Test-Path $CloudflaredExe) {
    Write-OK "cloudflared already present at $CloudflaredExe — skipping download"
} else {
    Invoke-WebRequest -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -OutFile $CloudflaredExe
    Write-OK "Downloaded to $CloudflaredExe"
}
& $CloudflaredExe --version

# ── Install the Windows service (registered now, configured later) ─────────

Write-Step "Installing the Cloudflared Windows service"
$existingService = Get-Service -Name "Cloudflared" -ErrorAction SilentlyContinue
if ($existingService) {
    Write-OK "Cloudflared service already installed — skipping"
} else {
    & $CloudflaredExe service install
    if ($LASTEXITCODE -ne 0) { throw "cloudflared service install failed (exit code $LASTEXITCODE)" }
    Write-OK "Service installed"
}

New-Item -ItemType Directory -Force -Path $SystemCfDir | Out-Null

# ── Log in (interactive — opens a browser) ──────────────────────────────────

Write-Step "Logging in to Cloudflare"
Write-Warn "A browser window will open. Log in and authorize the pollys.food zone."
& $CloudflaredExe tunnel login
if ($LASTEXITCODE -ne 0) { throw "cloudflared tunnel login failed (exit code $LASTEXITCODE)" }

$CertPath = Join-Path $UserCfDir "cert.pem"
if (-not (Test-Path $CertPath)) { throw "Login didn't produce $CertPath — something went wrong." }
Copy-Item $CertPath (Join-Path $SystemCfDir "cert.pem") -Force
Write-OK "Logged in, cert copied to the SYSTEM profile"

# ── Create the tunnel (or reuse an existing one with the same name) ────────

Write-Step "Creating tunnel '$TunnelName'"
$existingTunnel = & $CloudflaredExe tunnel list -o json | ConvertFrom-Json | Where-Object { $_.name -eq $TunnelName }
if ($existingTunnel) {
    $TunnelId = $existingTunnel.id
    Write-OK "Tunnel '$TunnelName' already exists (id: $TunnelId) — reusing it"
} else {
    & $CloudflaredExe tunnel create $TunnelName
    if ($LASTEXITCODE -ne 0) { throw "cloudflared tunnel create failed (exit code $LASTEXITCODE)" }
    $TunnelId = (& $CloudflaredExe tunnel list -o json | ConvertFrom-Json | Where-Object { $_.name -eq $TunnelName }).id
    Write-OK "Created tunnel '$TunnelName' (id: $TunnelId)"
}

$CredsFileName = "$TunnelId.json"
Copy-Item (Join-Path $UserCfDir $CredsFileName) (Join-Path $SystemCfDir $CredsFileName) -Force
Write-OK "Tunnel credentials copied to the SYSTEM profile"

# ── Write config.yml (in the SYSTEM profile, where the service looks) ──────

Write-Step "Writing config.yml"
$ConfigPath = Join-Path $SystemCfDir "config.yml"
$CredsPathForConfig = Join-Path $SystemCfDir $CredsFileName

$IngressLines = ($Hostnames | ForEach-Object {
    "  - hostname: $_`n    service: http://localhost:$LocalPort"
}) -join "`n"

@"
tunnel: $TunnelId
credentials-file: $CredsPathForConfig

ingress:
$IngressLines
  - service: http_status:404
"@ | Set-Content -Path $ConfigPath -Encoding UTF8

Write-OK "Wrote $ConfigPath"

Write-Step "Validating config"
& $CloudflaredExe tunnel --config $ConfigPath ingress validate
if ($LASTEXITCODE -ne 0) { throw "Config validation failed — check $ConfigPath" }
Write-OK "Config is valid"

# ── DNS routes ───────────────────────────────────────────────────────────────

Write-Step "Routing DNS to this tunnel"
foreach ($hostname in $Hostnames) {
    Write-Warn "Pointing $hostname at tunnel '$TunnelName' (overwriting any existing record)"
    & $CloudflaredExe tunnel route dns --overwrite-dns $TunnelName $hostname
    if ($LASTEXITCODE -ne 0) { throw "Failed to route DNS for $hostname (exit code $LASTEXITCODE)" }
}
Write-OK "DNS routed for: $($Hostnames -join ', ')"

# ── Point the service at this config and start it ───────────────────────────

Write-Step "Pointing the Windows service at this config and starting it"
$ImagePath = "`"$CloudflaredExe`" --config=`"$ConfigPath`" tunnel run"
Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Services\Cloudflared" -Name "ImagePath" -Value $ImagePath

Restart-Service -Name "Cloudflared" -Force
Start-Sleep -Seconds 3
$svc = Get-Service -Name "Cloudflared"
if ($svc.Status -ne 'Running') {
    throw "Cloudflared service did not start — check Event Viewer / run '$CloudflaredExe --config $ConfigPath tunnel run' manually to see the error."
}
Write-OK "Cloudflared service is running"

# ── Done ─────────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "  Tunnel is live!" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Green
Write-Host ""
Write-Host "  $($Hostnames -join ' and ') now route to http://localhost:$LocalPort on this machine."
Write-Host "  DNS may take a few minutes to propagate."
Write-Host ""
Write-Host "  Check status:   Get-Service Cloudflared"
Write-Host "  Restart:        Restart-Service Cloudflared"
Write-Host "  Config file:    $ConfigPath"
Write-Host ""
