const bcrypt = require('bcryptjs');
const { nativeTheme } = require('electron');
const { User, THEMES } = require('../models');
const session = require('../session');
const idle = require('../idle');
const { handle, AppError, str, oneOf, int } = require('./helpers');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ROUNDS = 12;

// naive brute-force guard: 5 failures -> 60s lockout per email
const attempts = new Map();
function checkLock(email) {
  const a = attempts.get(email);
  if (a && a.count >= 5 && Date.now() < a.until) throw new AppError('Too many attempts. Try again in a minute.', 'RATE_LIMITED');
}
function fail(email) {
  const a = attempts.get(email) || { count: 0, until: 0 };
  a.count += 1; a.until = Date.now() + 60_000;
  attempts.set(email, a);
}

const publicUser = (u) => ({ id: u._id, email: u.email, displayName: u.displayName, preferences: u.preferences });
const applyTheme = (u) => {
  nativeTheme.themeSource = u.preferences?.theme || 'dark';
  idle.setThreshold(u.preferences?.idleMinutes ?? 10);
};

function validatePassword(p) {
  if (typeof p !== 'string' || p.length < 8 || p.length > 128) throw new AppError('Password must be 8-128 characters');
  return p;
}

function register() {
  handle('auth:register', async ({ payload }) => {
    const email = str(payload.email, { max: 254, required: true }).toLowerCase();
    if (!EMAIL_RE.test(email)) throw new AppError('Invalid email address');
    const displayName = str(payload.displayName, { max: 80, required: true });
    const passwordHash = await bcrypt.hash(validatePassword(payload.password), ROUNDS);
    try {
      const user = await User.create({ email, displayName, passwordHash });
      session.start(user._id);
      applyTheme(user);
      return publicUser(user);
    } catch (e) {
      if (e.code === 11000) throw new AppError('An account with this email already exists', 'CONFLICT');
      throw e;
    }
  }, { auth: false });

  handle('auth:login', async ({ payload }) => {
    const email = str(payload.email, { max: 254, required: true }).toLowerCase();
    checkLock(email);
    const user = await User.findOne({ email }).select('+passwordHash');
    const ok = user && (await bcrypt.compare(String(payload.password || ''), user.passwordHash));
    if (!ok) { fail(email); throw new AppError('Invalid email or password', 'INVALID_CREDENTIALS'); }
    attempts.delete(email);
    session.start(user._id);
    applyTheme(user);
    return publicUser(user);
  }, { auth: false });

  handle('auth:logout', async () => { session.clear(); return true; }, { auth: false });

  // Called by React on launch to decide between the login screen and the board
  handle('auth:session', async () => {
    const id = session.userId();
    if (!id) return null;
    const user = await User.findById(id);
    if (!user) { session.clear(); return null; }
    applyTheme(user);
    return publicUser(user);
  }, { auth: false });
}

function settings() {
  handle('user:updateProfile', async ({ userId, payload }) => {
    const update = {};
    if (payload.displayName !== undefined) update.displayName = str(payload.displayName, { max: 80, required: true });
    if (payload.email !== undefined) {
      const email = str(payload.email, { max: 254, required: true }).toLowerCase();
      if (!EMAIL_RE.test(email)) throw new AppError('Invalid email address');
      update.email = email;
    }
    try {
      return publicUser(await User.findByIdAndUpdate(userId, update, { new: true, runValidators: true }));
    } catch (e) {
      if (e.code === 11000) throw new AppError('That email is already in use', 'CONFLICT');
      throw e;
    }
  });

  handle('user:changePassword', async ({ userId, payload }) => {
    const user = await User.findById(userId).select('+passwordHash');
    if (!(await bcrypt.compare(String(payload.currentPassword || ''), user.passwordHash)))
      throw new AppError('Current password is incorrect', 'INVALID_CREDENTIALS');
    user.passwordHash = await bcrypt.hash(validatePassword(payload.newPassword), ROUNDS);
    await user.save();
    return true;
  });

  handle('user:updatePreferences', async ({ userId, payload }) => {
    const set = {};
    if (payload.theme !== undefined) set['preferences.theme'] = oneOf(payload.theme, THEMES);
    if (payload.autoStartBreaks !== undefined) set['preferences.autoStartBreaks'] = !!payload.autoStartBreaks;
    const p = payload.pomodoro || {};
    if (p.focusMinutes !== undefined) set['preferences.pomodoro.focusMinutes'] = int(p.focusMinutes, 1, 180);
    if (p.shortBreakMinutes !== undefined) set['preferences.pomodoro.shortBreakMinutes'] = int(p.shortBreakMinutes, 1, 60);
    if (p.longBreakMinutes !== undefined) set['preferences.pomodoro.longBreakMinutes'] = int(p.longBreakMinutes, 1, 120);
    if (p.longBreakEvery !== undefined) set['preferences.pomodoro.longBreakEvery'] = int(p.longBreakEvery, 2, 12);
    if (payload.currency !== undefined) {
      const c = str(payload.currency, { max: 8, required: true }).toUpperCase();
      if (!/^[A-Z]{2,8}$/.test(c)) throw new AppError('Currency must be letters, e.g. LKR');
      set['preferences.currency'] = c;
    }
    if (payload.idleMinutes !== undefined) set['preferences.idleMinutes'] = int(payload.idleMinutes, 0, 240);
    if (p.enabled !== undefined) set['preferences.pomodoro.enabled'] = !!p.enabled;
    if (payload.weeklyPlan !== undefined) {
      const w = payload.weeklyPlan;
      if (!Array.isArray(w) || w.length !== 7 || w.some((h) => typeof h !== 'number' || h < 0 || h > 24)) throw new AppError('Weekly plan needs 7 values between 0 and 24');
      set['preferences.weeklyPlan'] = w;
    }
    const user = await User.findByIdAndUpdate(userId, { $set: set }, { new: true });
    applyTheme(user);
    return publicUser(user);
  });
}

module.exports = { registerAuthHandlers: () => { register(); settings(); } };
