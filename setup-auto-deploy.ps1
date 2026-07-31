# Rocky Da Adda — one-time auto-deploy setup (Windows)
#
# Run this ONCE, from this same folder, after install.ps1. It sets up a
# self-hosted GitHub Actions runner on this machine so that every push to
# master automatically pulls, rebuilds, and restarts the app here — no
# manual redeploy needed.
#
# Requirements:
#   - Node.js + pm2 already set up (run install.ps1 first)
#   - A GitHub runner registration token: go to
#       https://github.com/<owner>/<repo>/settings/actions/runners/new
#     choose Windows, and copy the token value shown in the config.cmd
#     snippet on that page (it expires after ~1 hour, single-use).
#
# The runner is registered to run WITHOUT a Windows service — instead it's
# launched from this Windows user's Startup folder, so it runs in the exact
# same login session as pm2 (a Windows service would run under a different
# account by default, and pm2 restart/save would silently talk to the wrong
# pm2 daemon).

param(
    [string]$RepoUrl = "https://github.com/AryanLuharuwala/Dosa-Inn-Food-Tracker",
    [string]$RunnerDir = "C:\actions-runner-rockyda"
)

$ErrorActionPreference = 'Stop'
$APP_DIR = $PSScriptRoot

function Write-Step { Write-Host "`n► $args" -ForegroundColor Green }
function Write-Warn { Write-Host "  $args" -ForegroundColor Yellow }
function Write-OK   { Write-Host "  ✓ $args" -ForegroundColor Cyan }

if (-not (Test-Path (Join-Path $APP_DIR "ecosystem.config.js"))) {
    throw "This doesn't look like the Rocky Da Adda folder (no ecosystem.config.js here). Run this script from the same folder as install.ps1."
}

# ── Registration token ──────────────────────────────────────────────────────

Write-Step "GitHub runner registration"
Write-Host "  Get a registration token from:"
Write-Host "    $RepoUrl/settings/actions/runners/new" -ForegroundColor Cyan
Write-Host "  (choose Windows — copy just the token value, it's single-use and expires in ~1 hour)"
Write-Host ""
$RegToken = Read-Host "  Paste the registration token"
if (-not $RegToken) { throw "A registration token is required." }

$RunnerName = Read-Host "  Runner name (default: $env:COMPUTERNAME)"
if (-not $RunnerName) { $RunnerName = $env:COMPUTERNAME }

# ── Download the runner ──────────────────────────────────────────────────────

Write-Step "Downloading the GitHub Actions runner"
New-Item -ItemType Directory -Force -Path $RunnerDir | Out-Null

if (Test-Path (Join-Path $RunnerDir "run.cmd")) {
    Write-OK "Runner already present at $RunnerDir — skipping download"
} else {
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/actions/runner/releases/latest"
    $asset = $release.assets | Where-Object { $_.name -match '^actions-runner-win-x64-.*\.zip$' } | Select-Object -First 1
    if (-not $asset) { throw "Could not find a Windows x64 runner asset in the latest actions/runner release." }

    $zipPath = Join-Path $RunnerDir $asset.name
    Write-OK "Latest runner: $($asset.name)"
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zipPath
    Expand-Archive -Path $zipPath -DestinationPath $RunnerDir -Force
    Remove-Item $zipPath
    Write-OK "Downloaded and extracted to $RunnerDir"
}

# ── Register ─────────────────────────────────────────────────────────────────

Write-Step "Registering the runner with GitHub"
Set-Location $RunnerDir
& "$RunnerDir\config.cmd" --url $RepoUrl --token $RegToken --name $RunnerName `
    --labels "windows,rockyda" --work "_work" --unattended --replace
if ($LASTEXITCODE -ne 0) {
    throw "config.cmd failed (exit code $LASTEXITCODE) — the token may have expired, get a fresh one and re-run this script."
}
Write-OK "Runner registered as '$RunnerName' with labels: windows, rockyda"

# ── Auto-start on login (no Windows service, no stored password) ────────────

Write-Step "Setting up auto-start on login"
$StartupDir = [Environment]::GetFolderPath('Startup')
$ShortcutPath = Join-Path $StartupDir "RockyDa GitHub Runner.lnk"

$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = "powershell.exe"
$Shortcut.Arguments = "-WindowStyle Hidden -ExecutionPolicy Bypass -Command `"& '$RunnerDir\run.cmd'`""
$Shortcut.WorkingDirectory = $RunnerDir
$Shortcut.WindowStyle = 7
$Shortcut.Save()
Write-OK "Runner will start automatically next time this Windows user logs in"

Write-Step "Starting the runner now"
Start-Process -FilePath "powershell.exe" `
    -ArgumentList "-WindowStyle Hidden -ExecutionPolicy Bypass -Command `"& '$RunnerDir\run.cmd'`"" `
    -WorkingDirectory $RunnerDir
Write-OK "Runner starting in the background"

# ── Point the workflow at this install folder ───────────────────────────────

Write-Step "Telling GitHub where this install lives"
$RepoSlug = ($RepoUrl -replace 'https://github.com/', '')
$gh = Get-Command gh -ErrorAction SilentlyContinue
if ($gh) {
    & gh variable set WINDOWS_APP_DIR --body "$APP_DIR" --repo $RepoSlug
    if ($LASTEXITCODE -eq 0) {
        Write-OK "Set the WINDOWS_APP_DIR repo variable to $APP_DIR"
    } else {
        Write-Warn "Could not set it automatically via gh — set it manually (see below)."
    }
} else {
    Write-Warn "gh CLI not found — set this manually:"
    Write-Warn "  $RepoUrl/settings/variables/actions -> New repository variable"
    Write-Warn "  Name: WINDOWS_APP_DIR   Value: $APP_DIR"
}

# ── Done ─────────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "  Auto-deploy is set up!" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Green
Write-Host ""
Write-Host "  Every push to master will now:"
Write-Host "    git pull -> npm install -> npm run build -> pm2 restart"
Write-Host "  right here in $APP_DIR"
Write-Host ""
Write-Host "  Check it worked: $RepoUrl/settings/actions/runners"
Write-Host "  (should show '$RunnerName' as Idle)"
Write-Host ""
Write-Host "  Deploy logs: $APP_DIR\logs\deploy.log"
Write-Host ""
