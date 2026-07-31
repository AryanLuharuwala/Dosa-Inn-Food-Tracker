#!/usr/bin/env bash
# Dosa Inn / Rocky Da Adda — Linux self-installer
# Usage: bash install.sh
# Tested on Ubuntu 20.04+ / Debian 11+ / Fedora 38+
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG="$APP_DIR/logs/install.log"
mkdir -p "$APP_DIR/logs"

# ── Helpers ───────────────────────────────────────────────────────────────────

green()  { echo -e "\033[0;32m$*\033[0m"; }
yellow() { echo -e "\033[0;33m$*\033[0m"; }
red()    { echo -e "\033[0;31m$*\033[0m"; }
die()    { red "ERROR: $*"; exit 1; }

step() {
    echo ""
    green "▶ $*"
}

require_cmd() {
    command -v "$1" &>/dev/null || die "$1 not found — please install it first"
}

# ── Node.js via nvm ───────────────────────────────────────────────────────────

step "Checking Node.js"
if ! command -v node &>/dev/null; then
    yellow "Node.js not found — installing via nvm"
    if [ ! -d "$HOME/.nvm" ]; then
        curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
    fi
    # shellcheck disable=SC1090
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
    nvm install --lts
    nvm use --lts
    nvm alias default node
    green "Node $(node --version) installed"
else
    NODE_MAJOR=$(node --version | cut -d'.' -f1 | tr -d 'v')
    if [ "$NODE_MAJOR" -lt 18 ]; then
        yellow "Node $(node --version) is too old — upgrading to LTS"
        export NVM_DIR="$HOME/.nvm"
        [ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
        nvm install --lts && nvm use --lts && nvm alias default node
    else
        green "Node $(node --version) OK"
    fi
fi

# ── pm2 ───────────────────────────────────────────────────────────────────────

step "Checking pm2"
PM2_BIN=""
if command -v pm2 &>/dev/null; then
    PM2_BIN="pm2"
    green "pm2 $(pm2 --version) OK"
elif [ -x "$HOME/.npm-global/bin/pm2" ]; then
    PM2_BIN="$HOME/.npm-global/bin/pm2"
    export PATH="$HOME/.npm-global/bin:$PATH"
    green "pm2 (user-local) OK"
elif [ -x "$APP_DIR/node_modules/.bin/pm2" ]; then
    PM2_BIN="$APP_DIR/node_modules/.bin/pm2"
    green "pm2 (project-local) OK"
else
    yellow "Installing pm2 to user prefix (~/.npm-global)"
    npm config set prefix "$HOME/.npm-global"
    npm install -g pm2
    export PATH="$HOME/.npm-global/bin:$PATH"
    PM2_BIN="$HOME/.npm-global/bin/pm2"
    # Persist PATH for future shells
    PROFILE="$HOME/.bashrc"
    grep -q '.npm-global/bin' "$PROFILE" 2>/dev/null || echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> "$PROFILE"
    green "pm2 $($PM2_BIN --version) installed"
fi

# ── Chromium (required by whatsapp-web.js / puppeteer) ───────────────────────

step "Checking Chromium for WhatsApp service"
if ! command -v chromium-browser &>/dev/null && ! command -v chromium &>/dev/null && ! command -v google-chrome &>/dev/null; then
    yellow "No Chromium found — attempting install"
    if command -v apt-get &>/dev/null; then
        sudo apt-get update -y && sudo apt-get install -y chromium-browser
    elif command -v dnf &>/dev/null; then
        sudo dnf install -y chromium
    elif command -v yum &>/dev/null; then
        sudo yum install -y chromium
    else
        yellow "Could not auto-install Chromium. Please install it manually."
    fi
else
    green "Chromium OK"
fi

# ── Dependencies ──────────────────────────────────────────────────────────────

step "Installing Next.js app dependencies"
cd "$APP_DIR"
npm install 2>&1 | tee -a "$LOG"

step "Installing WhatsApp service dependencies"
cd "$APP_DIR/whatsapp-service"
npm install 2>&1 | tee -a "$LOG"
cd "$APP_DIR"

# ── .env setup ────────────────────────────────────────────────────────────────

if [ ! -f "$APP_DIR/.env.local" ]; then
    step "First-time setup — configure your environment"
    echo ""
    yellow "No .env.local found. Let's set it up now."
    echo ""

    read -rp "  Admin password (default: admin123): " ADMIN_PASS
    ADMIN_PASS="${ADMIN_PASS:-admin123}"

    read -rp "  PhonePe Client ID: " PP_CLIENT_ID
    read -rp "  PhonePe Client Secret: " PP_CLIENT_SECRET
    read -rp "  PhonePe Client Version (default: 1): " PP_VERSION
    PP_VERSION="${PP_VERSION:-1}"
    read -rp "  PhonePe env [sandbox/production] (default: sandbox): " PP_ENV
    PP_ENV="${PP_ENV:-sandbox}"
    read -rp "  PhonePe merchant ID (for redirect URLs): " PP_MERCHANT_ID

    read -rp "  Next.js base URL (e.g. https://yoursite.com): " NEXT_URL
    read -rp "  LiveKit API key (leave blank to skip): " LK_KEY
    read -rp "  LiveKit API secret (leave blank to skip): " LK_SECRET
    read -rp "  LiveKit WebSocket URL (leave blank to skip): " LK_URL

    # Shared secret between dosa-inn-web and dosa-inn-whatsapp (see ecosystem.config.js)
    BOT_API_TOKEN="$(openssl rand -hex 24)"

    cat > "$APP_DIR/.env.local" << EOF
ADMIN_PASSWORD=${ADMIN_PASS}

PHONEPE_CLIENT_ID=${PP_CLIENT_ID}
PHONEPE_CLIENT_SECRET=${PP_CLIENT_SECRET}
PHONEPE_CLIENT_VERSION=${PP_VERSION}
PHONEPE_ENV=${PP_ENV}
PHONEPE_MERCHANT_ID=${PP_MERCHANT_ID}

NEXT_PUBLIC_BASE_URL=${NEXT_URL}

LIVEKIT_API_KEY=${LK_KEY}
LIVEKIT_API_SECRET=${LK_SECRET}
NEXT_PUBLIC_LIVEKIT_URL=${LK_URL}

WA_SERVICE_PORT=3478
BOT_API_TOKEN=${BOT_API_TOKEN}
EOF
    green ".env.local created"
else
    green ".env.local already exists — skipping"
fi

# ── Build ─────────────────────────────────────────────────────────────────────

step "Building Next.js app (this may take 1-2 minutes)"
cd "$APP_DIR"
npm run build 2>&1 | tee -a "$LOG"

# ── pm2 startup ───────────────────────────────────────────────────────────────

step "Setting up pm2 process manager"
cd "$APP_DIR"

# Stop any existing instances first
$PM2_BIN delete dosa-inn-web 2>/dev/null || true
$PM2_BIN delete dosa-inn-whatsapp 2>/dev/null || true

$PM2_BIN start ecosystem.config.js
$PM2_BIN save

step "Configuring pm2 to auto-start on boot"
STARTUP_CMD=$($PM2_BIN startup systemd -u "$USER" --hp "$HOME" 2>&1 | grep "sudo env" || true)
if [ -n "$STARTUP_CMD" ]; then
    yellow "Running: $STARTUP_CMD"
    eval "$STARTUP_CMD"
else
    yellow "Skipped auto-start — run '$PM2_BIN startup' manually if needed"
fi

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
green "═══════════════════════════════════════════════════════"
green "  Installation complete!"
green "═══════════════════════════════════════════════════════"
echo ""
echo "  App URL  : http://localhost:3000"
echo "  Admin     : http://localhost:3000/admin"
echo ""
echo "  pm2 commands (binary: $PM2_BIN):"
echo "    pm2 status            — see all processes"
echo "    pm2 logs              — tail all logs"
echo "    pm2 logs dosa-inn-web — tail web logs only"
echo "    pm2 restart all       — restart everything"
echo ""
echo "  WhatsApp: go to Admin → WA tab → Connect → scan QR"
echo ""
