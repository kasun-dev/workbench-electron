const { Tray, Menu, nativeImage, Notification, app } = require('electron');
const path = require('path');
const state = require('./state');

let tray = null;
let status = null;      // "WRK-111 Fork seal replacement" while a timer runs
let handlers = {};
let hinted = false;

function showWindow() {
  const w = state.mainWindow;
  if (!w || w.isDestroyed()) return;
  if (w.isMinimized()) w.restore();
  w.show();
  w.focus();
}

function refresh() {
  if (!tray) return;
  tray.setToolTip(status ? `Workbench | ${status}` : 'Workbench');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Workbench', click: showWindow },
    { type: 'separator' },
    { label: status ? `Running: ${status}` : 'No timer running', enabled: false },
    { label: 'Start / stop timer', click: () => handlers.onToggleTimer?.() },
    { label: 'Quick capture…', click: () => handlers.onCapture?.() },
    { label: 'Floating timer', type: 'checkbox', checked: !!handlers.isMiniOpen?.(), click: () => handlers.onToggleMini?.() },
    { type: 'separator' },
    { label: 'Quit Workbench', click: () => app.quit() },
  ]));
}

function createTray(h) {
  handlers = h;
  try {
    const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png'))
      .resize({ width: 16, height: 16, quality: 'best' });
    tray = new Tray(icon);
  } catch (err) {
    console.error('[tray] unavailable', err.message);
    return false;
  }
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);
  refresh();
  return true;
}

function setTimerStatus(text) { status = text ? String(text).slice(0, 80) : null; refresh(); }

function hintOnce() {
  if (hinted || !Notification.isSupported()) return;
  hinted = true;
  new Notification({ title: 'Workbench is still running', body: 'Your timer keeps going in the background. Use the tray icon to reopen or quit.' }).show();
}

module.exports = { createTray, setTimerStatus, hintOnce, showWindow, refresh };
