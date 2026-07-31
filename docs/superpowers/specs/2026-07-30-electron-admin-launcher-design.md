# Windows start/stop scripts + Electron admin launcher

Date: 2026-07-30
Status: Approved (pending final spec review)

## Problem

The app already runs on Windows via pm2 (`install.ps1` sets it up, `start.bat` starts it). Two gaps:

1. There's a `start.bat` but no matching stop/restart script.
2. There's no desktop-icon experience for the admin panel — the restaurant owner has to know to open a browser and type `localhost:3000/admin`. We want a double-clickable desktop icon that behaves like a normal Windows app: opens straight to the admin dashboard, manages the server underneath so the owner never touches pm2 or a terminal.

## Scope

- `stop.bat` / `restart.bat` at the repo root, matching the existing `start.bat` pattern.
- A new `electron-admin/` Electron app that:
  - Starts the pm2-managed server if it isn't already running.
  - Opens the admin page (`/admin`) in a native window.
  - Lives in the system tray when closed, rather than quitting (so the server keeps serving customers/kitchen).
  - Is packaged with `electron-builder` into an NSIS installer that creates Start Menu + Desktop shortcuts.

Out of scope: rewriting the process manager (staying on pm2), building the Windows installer from this Linux dev machine (the user will run the build step on the target Windows machine), any change to the Next.js app itself.

## 1. `stop.bat` / `restart.bat`

Mirror the existing `start.bat`'s structure exactly (same pm2-on-PATH guard, same `cd /d "%~dp0"`, same `pause` on error):

- `stop.bat` → `pm2 stop ecosystem.config.js`
- `restart.bat` → `pm2 restart ecosystem.config.js`

## 2. Electron admin launcher (`electron-admin/`)

### Layout

```
electron-admin/
├── package.json          # electron + electron-builder devDeps, build config
├── main.js                # main process
├── splash.html            # "Starting server…" loading screen
├── build/
│   └── icon.ico           # generated from public/logo.png (multi-res: 16/32/48/256)
└── .gitignore              # node_modules, dist/
```

### Repo-path resolution (first-run config)

The Electron app and the Next.js repo can be installed/moved independently, so the launcher needs to know where `ecosystem.config.js` lives to run pm2 with the right `cwd`.

- Config stored at `app.getPath('userData')/config.json` → `{ "repoPath": "C:\\...\\RockyDa" }`.
- On startup: if `config.json` is missing, or `repoPath` doesn't exist, or it doesn't contain `ecosystem.config.js`, show a native folder-picker (`dialog.showOpenDialog`, `properties: ['openDirectory']`) with instructions to select the Rocky Da Adda install folder. Validate the selection contains `ecosystem.config.js`; on failure, re-prompt with an error message. Save the valid path to `config.json`.
- Tray menu includes "Change Server Location…" which re-opens the picker and overwrites the saved path (covers reinstalls/moves without editing files by hand).

### Startup flow

1. Acquire single-instance lock (`app.requestSingleInstanceLock()`); if already held, focus the existing window/tray and exit.
2. Resolve `repoPath` (prompt if needed, as above).
3. Show the splash window (loads `splash.html`, "Starting server…" + spinner).
4. Run `pm2 jlist` (via `child_process.exec`, `cwd: repoPath`) and parse JSON to check whether `dosa-inn-web` is `online`.
   - If not running: run `pm2 start ecosystem.config.js` with `cwd: repoPath`.
   - If `pm2` isn't on PATH or the command fails: show an error dialog ("pm2 not found — run install.ps1 first" / the actual stderr) and quit.
5. Poll `http://localhost:3000/admin` (plain `http.get`, every 500ms, ~30s timeout) until it responds.
   - On success: create the main `BrowserWindow`, `loadURL('http://localhost:3000/admin')`, show it, close the splash window.
   - On timeout: show an error dialog with troubleshooting hint and quit.
6. Create the tray icon (`build/icon.ico`) with menu: **Show Admin**, **Restart Server** (`pm2 restart ecosystem.config.js`), **Change Server Location…**, separator, **Stop Server & Quit** (`pm2 stop ecosystem.config.js` then `app.quit()`).
7. Main window `close` event: `event.preventDefault(); win.hide()` — minimizes to tray instead of quitting. The app only fully quits via the tray's "Stop Server & Quit", or `app.on('before-quit', ...)` setting a flag so a real quit isn't re-intercepted.

### Packaging

- `package.json` `build` config (electron-builder): `appId`, `productName: "Rocky Da Adda Admin"`, `win.target: "nsis"`, `icon: build/icon.ico`, `nsis: { createDesktopShortcut: true, createStartMenuShortcut: true }`.
- Port (3000) is hardcoded to match `ecosystem.config.js`'s `PORT` env — documented in a comment, not made configurable (YAGNI; changing the app's port already requires editing `ecosystem.config.js` by hand).
- Build step happens **on the Windows machine**: `cd electron-admin && npm install && npm run dist`. This Linux dev environment only prepares the icon and source; it won't attempt a cross-build.

## Error handling

- pm2 missing/not on PATH → dialog + quit, points to `install.ps1`.
- `pm2 start` fails (bad ecosystem file, port in use, etc.) → dialog showing stderr + quit.
- Server never responds within ~30s → dialog with a troubleshooting hint (check pm2 logs) + quit.
- Selected folder doesn't contain `ecosystem.config.js` → re-prompt, doesn't save.

## Testing

This is a Windows-only, native-window Electron app — it can't be exercised end-to-end on this Linux dev machine. Verification here is limited to:
- `node --check` syntax validation on `main.js`.
- Code review against this spec.
- Manual end-to-end testing must happen on the target Windows machine (the user will do this after building the installer there).
