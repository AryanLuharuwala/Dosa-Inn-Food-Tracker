@echo off
:: Dosa Inn — quick restart (Windows)
:: Restarts both Next.js and WhatsApp service processes managed by pm2.

cd /d "%~dp0"

where pm2 >nul 2>&1
if errorlevel 1 (
    echo pm2 not found. Run install.ps1 first.
    pause
    exit /b 1
)

pm2 restart ecosystem.config.js
pause
