// Machine-specific desktop settings (not stored in MongoDB)
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULTS = { runInBackground: true, launchAtLogin: false, startHidden: false, miniTimer: false, globalShortcuts: true };
let cache = null;
const file = () => path.join(app.getPath('userData'), 'local-settings.json');

function get() {
  if (cache) return cache;
  try { cache = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file(), 'utf8')) }; } catch { cache = { ...DEFAULTS }; }
  return cache;
}
function set(patch) {
  const next = { ...get() };
  for (const k of Object.keys(DEFAULTS)) if (typeof patch[k] === 'boolean') next[k] = patch[k];
  cache = next;
  try { fs.writeFileSync(file(), JSON.stringify(next)); } catch (e) { console.error('[settings]', e.message); }
  return next;
}
module.exports = { get, set };
