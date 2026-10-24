const { BrowserWindow } = require('electron');
// Push an event to every open window (main window + floating timer)
const broadcast = (channel, payload) =>
  BrowserWindow.getAllWindows().forEach((w) => { if (!w.isDestroyed()) w.webContents.send(channel, payload); });
module.exports = { broadcast };
