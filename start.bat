@echo off
:: Dosa Inn — quick start (Windows)
:: Starts both Next.js and WhatsApp service via pm2.
:: Run install.ps1 first to set everything up.

cd /d "%~dp0"

where pm2 >nul 2>&1
if errorlevel 1 (
    echo pm2 not found. Run install.ps1 first.
    pause
    exit /b 1
)

pm2 start ecosystem.config.js
pm2 logs
