# Rocky Da Adda Admin (desktop launcher)

A small Electron app that gives the admin panel a desktop icon on Windows. Clicking the
icon starts the server (via pm2) if it isn't already running, waits for it to come up,
then opens `/admin` in its own window. Closing the window minimizes it to the system
tray — the server keeps running for the kitchen/customers. Use the tray menu to restart
or fully stop the server.

## Build the installer (run on the Windows machine)

```powershell
cd electron-admin
npm install
npm run dist
```

This produces an NSIS installer under `electron-admin/dist/` that creates Start Menu and
Desktop shortcuts for "Rocky Da Adda Admin".

## First run

On first launch you'll be asked to locate the Rocky Da Adda install folder (the one
containing `ecosystem.config.js`) — this only needs to be set once and is remembered
between launches. Use the tray menu's "Change Server Location…" if you ever move or
reinstall the app elsewhere.

## Requirements

- Node.js and pm2 already set up via `install.ps1` in the main app folder — this launcher
  drives pm2, it doesn't replace it.
