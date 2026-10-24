const { ipcMain } = require('electron');
const mongoose = require('mongoose');
const session = require('../session');

class AppError extends Error {
  constructor(message, code = 'BAD_REQUEST') { super(message); this.code = code; }
}

// ---- validators ----
const str = (v, { max = 200, required = false } = {}) => {
  if (v == null) v = '';
  if (typeof v !== 'string') throw new AppError('Expected a string');
  v = v.trim();
  if (required && !v) throw new AppError('A required field is empty');
  if (v.length > max) throw new AppError(`Value too long (max ${max})`);
  return v;
};
const oneOf = (v, list) => { if (!list.includes(v)) throw new AppError(`Must be one of: ${list.join(', ')}`); return v; };
const oid = (v) => { if (!mongoose.isValidObjectId(v)) throw new AppError('Invalid id'); return v; };
const int = (v, min, max) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new AppError(`Must be an integer ${min}-${max}`);
  return n;
};

const dateStr = (v) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new AppError('Invalid date');
  const [y, m, d] = v.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) throw new AppError('Invalid date');
  return v;
};
const when = (v) => { const d = new Date(v); if (Number.isNaN(d.getTime())) throw new AppError('Invalid date/time'); return d; };

// Only accept calls from our own renderer (file:// build or the Vite dev server)
function trusted(event) {
  const url = event.senderFrame?.url || '';
  const dev = process.env.VITE_DEV_SERVER_URL;
  return url.startsWith('file://') || (dev && url.startsWith(dev));
}

// Every handler returns { ok, data } | { ok:false, error:{ code, message } }
// JSON round-trip turns ObjectIds into strings and Dates into ISO strings.
function handle(channel, fn, { auth = true } = {}) {
  ipcMain.handle(channel, async (event, payload) => {
    try {
      if (!trusted(event)) throw new AppError('Forbidden', 'FORBIDDEN');
      let userId = null;
      if (auth) {
        userId = session.userId();
        if (!userId) throw new AppError('Not authenticated', 'UNAUTHENTICATED');
      }
      const data = await fn({ userId, payload: payload ?? {}, event });
      return { ok: true, data: data === undefined ? null : JSON.parse(JSON.stringify(data)) };
    } catch (err) {
      if (!(err instanceof AppError)) console.error(`[ipc:${channel}]`, err);
      return {
        ok: false,
        error: err instanceof AppError
          ? { code: err.code, message: err.message }
          : { code: 'INTERNAL', message: 'Something went wrong' },
      };
    }
  });
}

module.exports = { AppError, handle, str, oneOf, oid, int, dateStr, when };
