// Machine-specific desktop settings (not stored in MongoDB)
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  runInBackground: true,
  launchAtLogin: false,
  startHidden: false,
  miniTimer: false,
  globalShortcuts: true,
  geminiModel: 'gemini-2.5-flash',
  geminiKeyEnc: '',
  geminiKeyPlain: '',
};
let cache = null;

const file = () => path.join(app.getPath('userData'), 'local-settings.json');

function loadRaw() {
  if (cache) return cache;
  try { cache = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file(), 'utf8')) }; } catch { cache = { ...DEFAULTS }; }
  return cache;
}

function getApiKey() {
  const raw = loadRaw();
  if (raw.geminiKeyEnc && safeStorage.isEncryptionAvailable()) {
    try { return safeStorage.decryptString(Buffer.from(raw.geminiKeyEnc, 'base64')); } catch {}
  }
  if (raw.geminiKeyPlain) return raw.geminiKeyPlain;
  return process.env.GEMINI_API_KEY || '';
}

function maskKey(k) {
  if (!k) return '';
  return k.length <= 8 ? '••••••••' : `${k.slice(0, 4)}••••${k.slice(-4)}`;
}

function get() {
  const raw = loadRaw();
  const key = getApiKey();
  return {
    runInBackground: !!raw.runInBackground,
    launchAtLogin: !!raw.launchAtLogin,
    startHidden: !!raw.startHidden,
    miniTimer: !!raw.miniTimer,
    globalShortcuts: !!raw.globalShortcuts,
    geminiModel: raw.geminiModel || 'gemini-2.5-flash',
    hasApiKey: !!key,
    maskedApiKey: maskKey(key),
  };
}

function set(patch = {}) {
  const next = { ...loadRaw() };
  for (const k of ['runInBackground', 'launchAtLogin', 'startHidden', 'miniTimer', 'globalShortcuts']) {
    if (typeof patch[k] === 'boolean') next[k] = patch[k];
  }
  if (typeof patch.geminiModel === 'string' && patch.geminiModel.trim()) {
    next.geminiModel = patch.geminiModel.trim();
  }
  if (typeof patch.geminiApiKey === 'string') {
    const k = patch.geminiApiKey.trim();
    if (!k) {
      next.geminiKeyEnc = '';
      next.geminiKeyPlain = '';
    } else if (safeStorage.isEncryptionAvailable()) {
      next.geminiKeyEnc = safeStorage.encryptString(k).toString('base64');
      next.geminiKeyPlain = '';
    } else {
      next.geminiKeyPlain = k;
      next.geminiKeyEnc = '';
    }
  }
  cache = next;
  try { fs.writeFileSync(file(), JSON.stringify(next), { mode: 0o600 }); } catch (e) { console.error('[settings]', e.message); }
  return get();
}

module.exports = { get, set, getApiKey };