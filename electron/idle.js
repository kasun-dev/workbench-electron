// Detects "you walked away while the timer was running" (inactivity, screen lock, sleep)
const { powerMonitor } = require('electron');
const { TimeLog } = require('./models');
const session = require('./session');
const state = require('./state');
const { showWindow } = require('./tray');

let thresholdMin = 10; // 0 = off
let prompted = false;
let awayStart = null;

const setThreshold = (n) => { thresholdMin = Number(n) || 0; };

async function prompt(sinceMs) {
  try {
    const uid = session.userId();
    if (!uid || !(await TimeLog.exists({ user: uid, isRunning: true }))) return;
    const w = state.mainWindow;
    if (!w || w.isDestroyed()) return;
    showWindow();
    w.webContents.send('idle:prompt', { since: new Date(sinceMs).toISOString(), idleSeconds: Math.round((Date.now() - sinceMs) / 1000) });
  } catch (e) { console.error('[idle]', e.message); }
}

function start() {
  setInterval(() => {
    if (!thresholdMin) return;
    const idle = powerMonitor.getSystemIdleTime();
    if (idle < 30) { prompted = false; return; }
    if (!prompted && idle >= thresholdMin * 60) { prompted = true; prompt(Date.now() - idle * 1000); }
  }, 15000);

  const away = () => { awayStart = awayStart || Date.now(); };
  const back = () => {
    if (awayStart && thresholdMin && Date.now() - awayStart >= thresholdMin * 60000) { prompted = true; prompt(awayStart); }
    awayStart = null;
  };
  powerMonitor.on('lock-screen', away);
  powerMonitor.on('suspend', away);
  powerMonitor.on('unlock-screen', back);
  powerMonitor.on('resume', back);
}

module.exports = { start, setThreshold };
