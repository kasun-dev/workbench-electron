// Desktop-level settings: run in background, launch at login, floating timer, global shortcuts
const { app } = require('electron');
const localSettings = require('../localSettings');
const mini = require('../mini');
const shortcuts = require('../shortcuts');
const tray = require('../tray');
const { handle } = require('./helpers');

function applySystemSettings(next) {
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: next.launchAtLogin, args: next.startHidden ? ['--hidden'] : [] });
  shortcuts.apply(next.globalShortcuts);
  if (next.miniTimer) mini.open(); else mini.close();
  tray.refresh();
}

const view = (s) => ({ ...s, packaged: app.isPackaged });

function registerSystemHandlers() {
  handle('system:get', () => view(localSettings.get()), { auth: false });
  handle('system:set', ({ payload }) => {
    const next = localSettings.set(payload || {});
    applySystemSettings(next);
    return view(next);
  }, { auth: false });
  handle('system:toggleMini', () => {
    const next = localSettings.set({ miniTimer: !mini.isOpen() });
    applySystemSettings(next);
    return view(next);
  }, { auth: false });
}

module.exports = { registerSystemHandlers, applySystemSettings };
