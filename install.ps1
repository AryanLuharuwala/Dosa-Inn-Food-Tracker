# Dosa Inn / Rocky Da Adda — Windows self-installer
# Run in PowerShell as Administrator (required for pm2 startup):
#   Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
#   .\install.ps1
#
# Or without admin (pm2 auto-start on boot won't be configured):
#   .\install.ps1
param(
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$APP_DIR = $PSScriptRoot

function Write-Step  { Write-Host "`n► $args" -ForegroundColor Green }
function Write-Warn  { Write-Host "  $args" -ForegroundColor Yellow }
function Write-OK    { Write-Host "  ✓ $args" -ForegroundColor Cyan }
function Write-Fail  { Write-Host "  ✗ $args" -ForegroundColor Red }

# ── Node.js ────────────────────────────────────────────────────────────────────

Write-Step "Checking Node.js"
$nodeOk = $false
try {
    $nodeVer = (node --version 2>&1).ToString().TrimStart('v')
    $nodeMajor = [int]($nodeVer.Split('.')[0])
    if ($nodeMajor -ge 18) {
        Write-OK "Node v$nodeVer"
        $nodeOk = $true
    } else {
        Write-Warn "Node v$nodeVer is too old (need 18+)"
    }
} catch { Write-Warn "Node not found" }

if (-not $nodeOk) {
    Write-Warn "Please install Node.js 20 LTS from https://nodejs.org/en/download"
    Write-Warn "Then re-run this script."
    exit 1
}

# ── pm2 ────────────────────────────────────────────────────────────────────────

Write-Step "Checking pm2"
$pm2Cmd = $null
try {
    $v = (pm2 --version 2>&1).ToString()
    Write-OK "pm2 $v"
    $pm2Cmd = "pm2"
} catch {
    Write-Warn "pm2 not found — installing"
    npm install -g pm2
    $pm2Cmd = "pm2"
    Write-OK "pm2 installed"
}

# ── Dependencies ───────────────────────────────────────────────────────────────

Write-Step "Installing Next.js dependencies"
Set-Location $APP_DIR
npm install

Write-Step "Installing WhatsApp service dependencies"
Set-Location "$APP_DIR\whatsapp-service"
npm install
Set-Location $APP_DIR

# ── .env.local ─────────────────────────────────────────────────────────────────

$envFile = "$APP_DIR\.env.local"
if (-not (Test-Path $envFile)) {
    Write-Step "First-time setup — configure environment"
    Write-Host ""

    $adminPass   = Read-Host "  Admin password (default: admin123)"
    if (-not $adminPass) { $adminPass = "admin123" }

    $ppId        = Read-Host "  PhonePe Client ID"
    $ppSecret    = Read-Host "  PhonePe Client Secret"
    $ppVersion   = Read-Host "  PhonePe Client Version (default: 1)"
    if (-not $ppVersion) { $ppVersion = "1" }
    $ppEnv       = Read-Host "  PhonePe env [sandbox/production] (default: sandbox)"
    if (-not $ppEnv) { $ppEnv = "sandbox" }
    $ppMerchant  = Read-Host "  PhonePe Merchant ID"

    $baseUrl     = Read-Host "  App base URL (e.g. https://yoursite.com)"
    $lkKey       = Read-Host "  LiveKit API key (leave blank to skip)"
    $lkSecret    = Read-Host "  LiveKit API secret (leave blank to skip)"
    $lkUrl       = Read-Host "  LiveKit WebSocket URL (leave blank to skip)"

    @"
ADMIN_PASSWORD=$adminPass

PHONEPE_CLIENT_ID=$ppId
PHONEPE_CLIENT_SECRET=$ppSecret
PHONEPE_CLIENT_VERSION=$ppVersion
PHONEPE_ENV=$ppEnv
PHONEPE_MERCHANT_ID=$ppMerchant

NEXT_PUBLIC_BASE_URL=$baseUrl

LIVEKIT_API_KEY=$lkKey
LIVEKIT_API_SECRET=$lkSecret
NEXT_PUBLIC_LIVEKIT_URL=$lkUrl

WA_SERVICE_PORT=3478
"@ | Set-Content $envFile -Encoding UTF8
    Write-OK ".env.local created"
} else {
    Write-OK ".env.local already exists — skipping"
}

# ── Build ──────────────────────────────────────────────────────────────────────

if (-not $SkipBuild) {
    Write-Step "Building Next.js app"
    Set-Location $APP_DIR
    npm run build
    Write-OK "Build complete"
}

# ── pm2 ────────────────────────────────────────────────────────────────────────

Write-Step "Starting services with pm2"
Set-Location $APP_DIR
New-Item -ItemType Directory -Force -Path "$APP_DIR\logs" | Out-Null

& $pm2Cmd delete dosa-inn-web       2>$null
& $pm2Cmd delete dosa-inn-whatsapp  2>$null
& $pm2Cmd start ecosystem.config.js
& $pm2Cmd save

# Auto-start on Windows boot (requires Admin)
Write-Step "Configuring pm2 to auto-start on boot"
try {
    & $pm2Cmd startup | Out-Null
    Write-OK "pm2 startup configured"
} catch {
    Write-Warn "Skipped auto-start (run 'pm2 startup' as Administrator if needed)"
}

# ── Done ───────────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "  Installation complete!" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Green
Write-Host ""
Write-Host "  App URL  : http://localhost:3000"
Write-Host "  Admin    : http://localhost:3000/admin"
Write-Host ""
Write-Host "  pm2 commands:"
Write-Host "    pm2 status            — see all processes"
Write-Host "    pm2 logs              — tail all logs"
Write-Host "    pm2 restart all       — restart everything"
Write-Host ""
Write-Host "  WhatsApp: go to Admin → WA tab → Connect → scan QR"
Write-Host ""
