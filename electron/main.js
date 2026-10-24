const { app, BrowserWindow, Notification, dialog, shell, nativeTheme, globalShortcut, session: electronSession } = require('electron');
const path = require('path');
const mongoose = require('mongoose');

// Credentials are loaded here, in the main process only. They are never sent to the renderer.
require('dotenv').config({
  path: app.isPackaged ? path.join(process.resourcesPath, '.env') : path.join(__dirname, '..', '.env'),
});

// Some ISPs/routers/VPNs break the DNS SRV lookups that mongodb+srv:// needs (querySrv EBADRESP).
// Set DNS_SERVERS=8.8.8.8,1.1.1.1 in .env to bypass them.
if (process.env.DNS_SERVERS) {
  require('dns').setServers(process.env.DNS_SERVERS.split(',').map((s) => s.trim()).filter(Boolean));
}

const { connectDB } = require('./db');
const session = require('./session');
const state = require('./state');
const localSettings = require('./localSettings');
const mini = require('./mini');
const shortcuts = require('./shortcuts');
const idle = require('./idle');
const registerIpc = require('./ipc');
const { stopRunning, toggleTimer } = require('./ipc/timer');
const { applySystemSettings } = require('./ipc/system');
const { createTray, hintOnce, showWindow } = require('./tray');

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const START_HIDDEN = process.argv.includes('--hidden'); // set when launched at login
let trayOk = false;

function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1024, minHeight: 640,
    backgroundColor: '#0b0b0d',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,   // renderer can't touch Electron/Node internals
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false, // keep the live clock + focus notification accurate while hidden
    },
  });
  state.mainWindow = win;

  win.once('ready-to-show', () => { if (!(START_HIDDEN && trayOk)) win.show(); });

  // Close button: hide to tray (timer keeps running) or really quit, per the "Run in background" setting
  win.on('close', (e) => {
    if (state.quitting) return;
    e.preventDefault();
    if (trayOk && localSettings.get().runInBackground) { win.hide(); hintOnce(); } else app.quit();
  });
  win.on('closed', () => { state.mainWindow = null; });

  // Lock navigation: the app only ever shows our own UI
  win.webContents.on('will-navigate', (e, url) => { if (!(DEV_URL && url.startsWith(DEV_URL))) e.preventDefault(); });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url); // links from task descriptions
    return { action: 'deny' };
  });

  if (DEV_URL) win.loadURL(DEV_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

// Content-Security-Policy (production only; Vite HMR needs inline scripts in dev)
function applyCsp() {
  if (DEV_URL) return;
  electronSession.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'",
        ],
      },
    });
  });
}

// Single instance (two instances = two timers fighting over one DB)
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
app.on('second-instance', showWindow);

if (process.platform === 'win32') app.setAppUserModelId('com.workbench.app'); // taskbar uses our icon

// Shared actions for the tray menu and global shortcuts
const actions = {
  onToggleTimer: async () => {
    const uid = session.userId();
    if (!uid) return showWindow();
    try {
      const r = await toggleTimer(uid);
      if (r.reason === 'no-task' && Notification.isSupported()) new Notification({ title: 'Workbench', body: 'Start a timer on a task first.' }).show();
    } catch (e) { console.error('[toggle]', e.message); }
    return undefined;
  },
  onCapture: () => { showWindow(); state.mainWindow?.webContents.send('cmd:capture'); },
  onToggleMini: () => {
    applySystemSettings(localSettings.set({ miniTimer: !mini.isOpen() }));
  },
  isMiniOpen: () => mini.isOpen(),
};

app.whenReady().then(async () => {
  if (!gotLock) return;
  try {
    await connectDB();
  } catch (err) {
    dialog.showErrorBox('Database error', `Could not connect to MongoDB.\n\n${err.message}`);
    return app.quit();
  }
  nativeTheme.themeSource = 'dark'; // default until the user's preference loads
  session.restore();
  applyCsp();
  registerIpc();
  createWindow();
  trayOk = createTray(actions);
  shortcuts.init(actions);
  applySystemSettings(localSettings.get());
  idle.start();
  app.on('activate', () => { if (state.mainWindow) showWindow(); else createWindow(); }); // macOS dock click
  return undefined;
});

// With a tray, the app stays alive when the window is hidden/closed.
app.on('window-all-closed', () => { if (!trayOk && process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => globalShortcut.unregisterAll());

// Real quit: close any open time log first so nothing is left "running" in the DB
let cleaned = false;
app.on('before-quit', async (e) => {
  state.quitting = true;
  if (cleaned) return;
  e.preventDefault();
  cleaned = true;
  try {
    const uid = session.userId();
    if (uid) await stopRunning(uid);
    await mongoose.disconnect();
  } catch (err) { console.error('[quit]', err); }
  app.quit();
});
