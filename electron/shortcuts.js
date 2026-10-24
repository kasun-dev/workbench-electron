const { globalShortcut } = require('electron');

let handlers = {};
const init = (h) => { handlers = h; };

// Ctrl/Cmd+Shift+T = start/stop timer, Ctrl/Cmd+Shift+N = quick capture (work from any app)
function apply(enabled) {
  globalShortcut.unregisterAll();
  if (!enabled) return;
  try {
    globalShortcut.register('CommandOrControl+Shift+T', () => handlers.onToggleTimer?.());
    globalShortcut.register('CommandOrControl+Shift+N', () => handlers.onCapture?.());
  } catch (e) { console.error('[shortcuts]', e.message); }
}
module.exports = { init, apply };
