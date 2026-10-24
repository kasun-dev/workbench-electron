// The session lives ONLY in the main process. The renderer never sees a token or
// a userId, so a compromised renderer can't impersonate another user.
// Persistence uses the OS keychain via safeStorage (DPAPI / Keychain / libsecret),
// which encrypts AND authenticates the blob, so it can't be forged on disk.
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const file = () => path.join(app.getPath('userData'), 'session.bin');
let current = null; // { userId, expiresAt }

function start(userId) {
  current = { userId: String(userId), expiresAt: Date.now() + TTL_MS };
  if (safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(file(), safeStorage.encryptString(JSON.stringify(current)), { mode: 0o600 });
  }
}

function restore() {
  try {
    const data = JSON.parse(safeStorage.decryptString(fs.readFileSync(file())));
    if (data.expiresAt > Date.now()) current = data;
    else clear();
  } catch { current = null; }
  return current?.userId ?? null;
}

function clear() {
  current = null;
  try { fs.unlinkSync(file()); } catch {}
}

const userId = () => current?.userId ?? null;

module.exports = { start, restore, clear, userId };
