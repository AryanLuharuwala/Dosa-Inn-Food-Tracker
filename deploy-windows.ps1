# Rocky Da Adda — Windows auto-deploy
#
# Invoked by the self-hosted GitHub Actions runner (see setup-auto-deploy.ps1)
# on every push to master. Runs in place, in whatever folder this script
# actually lives in — that folder IS the live install pm2 is serving from.
#
# On any failure, the previously running app is left untouched: the pm2
# processes from the last successful deploy just keep running.

$ErrorActionPreference = 'Stop'
$APP_DIR = $PSScriptRoot
Set-Location $APP_DIR

$LogDir = Join-Path $APP_DIR 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$LogFile = Join-Path $LogDir 'deploy.log'

function Log($msg) {
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
    Write-Host $line
    Add-Content -Path $LogFile -Value $line
}

function Run($desc, $exe, $exeArgs) {
    Log $desc
    & $exe @exeArgs
    if ($LASTEXITCODE -ne 0) {
        throw "$desc failed (exit code $LASTEXITCODE)"
    }
}

try {
    Log "==================== Deploy starting ===================="

    Run "git fetch origin master" "git" @("fetch", "origin", "master")
    Run "git reset --hard origin/master" "git" @("reset", "--hard", "origin/master")

    Run "npm install (web app)" "npm" @("install")

    Set-Location (Join-Path $APP_DIR "whatsapp-service")
    Run "npm install (whatsapp-service)" "npm" @("install")
    Set-Location $APP_DIR

    Run "npm run build" "npm" @("run", "build")

    Run "pm2 restart ecosystem.config.js" "pm2" @("restart", "ecosystem.config.js")
    Run "pm2 save" "pm2" @("save")

    Log "==================== Deploy succeeded ===================="
} catch {
    Log "==================== Deploy FAILED: $($_.Exception.Message) ===================="
    Log "The previously running app was left untouched."
    exit 1
}
