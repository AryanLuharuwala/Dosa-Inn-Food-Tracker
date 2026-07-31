const { app, BrowserWindow, Tray, Menu, dialog, shell } = require('electron');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const ADMIN_URL = 'http://localhost:3000/admin';
const PM2_PROCESS_NAME = 'dosa-inn-web';
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
const ICON_PATH = path.join(__dirname, 'build', 'icon.ico');

let mainWindow = null;
let splashWindow = null;
let tray = null;
let repoPath = null;
let isQuitting = false;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (splashWindow) {
      splashWindow.focus();
    } else if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(startup);
}

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  // Tray keeps the app alive — quitting only happens via the tray menu.
});

function isValidRepoPath(candidate) {
  return !!candidate && fs.existsSync(path.join(candidate, 'ecosystem.config.js'));
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

async function resolveRepoPath() {
  const config = loadConfig();
  if (config && isValidRepoPath(config.repoPath)) {
    return config.repoPath;
  }
  return promptForRepoPath();
}

async function promptForRepoPath() {
  while (true) {
    const result = await dialog.showOpenDialog({
      title: 'Locate your Rocky Da Adda install folder',
      message: 'Select the folder that contains ecosystem.config.js (the Rocky Da Adda app folder).',
      properties: ['openDirectory'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      dialog.showErrorBox('Rocky Da Adda Admin', 'A server folder is required to continue. The app will now quit.');
      app.quit();
      return null;
    }

    const candidate = result.filePaths[0];
    if (isValidRepoPath(candidate)) {
      saveConfig({ repoPath: candidate });
      return candidate;
    }

    dialog.showErrorBox(
      'Folder not recognized',
      `"${candidate}" does not contain ecosystem.config.js. Please select the correct Rocky Da Adda install folder.`
    );
  }
}

function runPm2(args) {
  return new Promise((resolve, reject) => {
    exec(`pm2 ${args}`, { cwd: repoPath }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
      } else {
        resolve(stdout);
      }
    });
  });
}

async function isServerRunning() {
  try {
    const stdout = await runPm2('jlist');
    const processes = JSON.parse(stdout);
    return processes.some((p) => p.name === PM2_PROCESS_NAME && p.pm2_env && p.pm2_env.status === 'online');
  } catch {
    return false;
  }
}

function waitForAdminReady(timeoutMs = 30000, intervalMs = 500) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(ADMIN_URL, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', retry);
      req.setTimeout(intervalMs, () => {
        req.destroy();
      });
    };
    const retry = () => {
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error('Timed out waiting for the server to respond.'));
        return;
      }
      setTimeout(check, intervalMs);
    };
    check();
  });
}

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 360,
    height: 220,
    frame: false,
    resizable: false,
    icon: ICON_PATH,
    webPreferences: { contextIsolation: true },
  });
  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    icon: ICON_PATH,
    title: 'Rocky Da Adda Admin',
    show: false,
    webPreferences: { contextIsolation: true },
  });

  mainWindow.loadURL(ADMIN_URL);

  mainWindow.once('ready-to-show', () => {
    if (splashWindow) {
      splashWindow.close();
      splashWindow = null;
    }
    mainWindow.show();
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  // Keep external links (e.g. anything opening a new tab) in the OS browser, not the admin window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function createTray() {
  tray = new Tray(ICON_PATH);
  tray.setToolTip('Rocky Da Adda Admin');
  rebuildTrayMenu();
  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function rebuildTrayMenu() {
  const menu = Menu.buildFromTemplate([
    {
      label: 'Show Admin',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: 'Restart Server',
      click: async () => {
        try {
          await runPm2('restart ecosystem.config.js');
        } catch (err) {
          dialog.showErrorBox('Restart failed', err.message);
        }
      },
    },
    {
      label: 'Change Server Location…',
      click: async () => {
        const newPath = await promptForRepoPath();
        if (newPath) {
          repoPath = newPath;
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Stop Server && Quit',
      click: async () => {
        try {
          await runPm2('stop ecosystem.config.js');
        } catch (err) {
          dialog.showErrorBox('Stop failed', err.message);
        } finally {
          isQuitting = true;
          app.quit();
        }
      },
    },
  ]);
  tray.setContextMenu(menu);
}

async function startup() {
  createSplashWindow();

  repoPath = await resolveRepoPath();
  if (!repoPath) return; // app.quit() already called

  const running = await isServerRunning();
  if (!running) {
    try {
      await runPm2('start ecosystem.config.js');
    } catch (err) {
      dialog.showErrorBox(
        'Could not start the server',
        `pm2 failed to start the app. Make sure install.ps1 has been run at least once.\n\n${err.message}`
      );
      app.quit();
      return;
    }
  }

  try {
    await waitForAdminReady();
  } catch (err) {
    dialog.showErrorBox(
      'Server did not respond',
      `The admin page did not become available in time. Check "pm2 logs" for errors.\n\n${err.message}`
    );
    app.quit();
    return;
  }

  createMainWindow();
  createTray();
}
