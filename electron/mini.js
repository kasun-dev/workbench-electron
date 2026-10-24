// Small always-on-top floating timer window
const { BrowserWindow, screen } = require('electron');
const path = require('path');
const state = require('./state');
const localSettings = require('./localSettings');

let win = null;
const isOpen = () => !!win && !win.isDestroyed();

function open() {
  if (isOpen()) { win.show(); return; }
  const { workArea } = screen.getPrimaryDisplay();
  win = new BrowserWindow({
    width: 280, height: 96, x: workArea.x + workArea.width - 300, y: workArea.y + 20,
    frame: false, transparent: true, resizable: false, maximizable: false, fullscreenable: false,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false, show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false,
    },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.once('ready-to-show', () => win.show());
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('closed', () => {
    win = null;
    if (!state.quitting) localSettings.set({ miniTimer: false }); // user closed it
    require('./tray').refresh();
  });
  const dev = process.env.VITE_DEV_SERVER_URL;
  if (dev) win.loadURL(`${dev}#mini`);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { hash: 'mini' });
}

function close() { if (isOpen()) win.close(); }

module.exports = { open, close, isOpen };
