const { Task, TimeLog, User } = require('../models');
const { handle } = require('./helpers');

const DEFAULT_PLAN = [8, 8, 8, 8, 6, 3, 0];
const DAY = 864e5;
const h1 = (s) => Math.round((s / 3600) * 10) / 10;
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function startOfWeek(d) { // Monday 00:00 local time
  const x = startOfDay(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

function registerAnalyticsHandlers() {
  handle('analytics:summary', async ({ userId }) => {
    const now = new Date();
    const today0 = startOfDay(now);
    const weekStart = startOfWeek(now);
    const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 7);
    const allocStart = new Date(now.getTime() - 7 * DAY);
    const yearStart = new Date(today0); yearStart.setDate(yearStart.getDate() - 364);

    const [user, logs] = await Promise.all([
      User.findById(userId).select('preferences.weeklyPlan').lean(),
      TimeLog.find({ user: userId, startTime: { $gte: yearStart } }).select('startTime durationSeconds isRunning task').lean(),
    ]);
    const secs = (l) => (l.isRunning ? Math.max(0, Math.round((now - l.startTime) / 1000)) : l.durationSeconds);

    const allocLogs = logs.filter((l) => l.startTime >= allocStart);
    const tasks = await Task.find({ _id: { $in: [...new Set(allocLogs.map((l) => String(l.task)))] } }).select('discipline').lean();
    const disc = new Map(tasks.map((t) => [String(t._id), t.discipline]));

    const actual = Array(7).fill(0);
    const alloc = new Map();
    const dayHours = new Map();
    let sessions = 0;
    for (const l of logs) {
      const s = secs(l);
      const key = ymd(l.startTime);
      dayHours.set(key, (dayHours.get(key) || 0) + s);
      if (l.startTime >= weekStart && l.startTime < weekEnd) { actual[(l.startTime.getDay() + 6) % 7] += s; sessions++; }
      if (l.startTime >= allocStart) {
        const name = disc.get(String(l.task)) || 'Uncategorised';
        alloc.set(name, (alloc.get(name) || 0) + s);
      }
    }

    // heatmap (365 days), streaks, 12-week trend
    const heatmap = [];
    for (let i = 364; i >= 0; i--) {
      const d = new Date(today0); d.setDate(d.getDate() - i);
      heatmap.push({ d: ymd(d), h: h1(dayHours.get(ymd(d)) || 0) });
    }
    let best = 0, run = 0;
    for (const x of heatmap) { run = x.h > 0 ? run + 1 : 0; best = Math.max(best, run); }
    let streak = 0;
    for (let i = heatmap.length - 1; i >= 0; i--) {
      if (heatmap[i].h > 0) streak++;
      else if (i === heatmap.length - 1) continue; // today may not have started yet
      else break;
    }
    const trend = [];
    for (let w = 11; w >= 0; w--) {
      const ws = new Date(weekStart); ws.setDate(ws.getDate() - w * 7);
      let sum = 0;
      for (let k = 0; k < 7; k++) { const d = new Date(ws); d.setDate(d.getDate() + k); sum += dayHours.get(ymd(d)) || 0; }
      trend.push({ label: `${ws.getMonth() + 1}/${ws.getDate()}`, hours: h1(sum) });
    }

    // estimate accuracy (completed tasks, last 90 days)
    const est = await Task.find({
      user: userId, status: 'completed', estimateMinutes: { $gt: 0 }, completedAt: { $gte: new Date(now.getTime() - 90 * DAY) },
    }).select('category estimateMinutes totalTrackedSeconds').lean();
    const eg = new Map();
    for (const t of est) {
      const k = t.category || 'Uncategorised';
      const g = eg.get(k) || { name: k, est: 0, act: 0, count: 0 };
      g.est += t.estimateMinutes * 60; g.act += t.totalTrackedSeconds; g.count++;
      eg.set(k, g);
    }
    const estTotal = est.reduce((a, t) => a + t.estimateMinutes * 60, 0);
    const actTotal = est.reduce((a, t) => a + t.totalTrackedSeconds, 0);

    const plan = user?.preferences?.weeklyPlan?.length === 7 ? user.preferences.weeklyPlan : DEFAULT_PLAN;
    const plannedTotal = plan.reduce((a, b) => a + b, 0);
    const actualTotal = actual.reduce((a, b) => a + b, 0) / 3600;
    const allocTotal = [...alloc.values()].reduce((a, b) => a + b, 0);

    return {
      planned: plan,
      actual: actual.map((s) => h1(s)),
      plannedTotal: Math.round(plannedTotal * 10) / 10,
      actualTotal: Math.round(actualTotal * 10) / 10,
      accuracy: plannedTotal ? Math.round((actualTotal / plannedTotal) * 100) : 0,
      sessions,
      allocationTotal: h1(allocTotal),
      allocation: [...alloc.entries()].sort((a, b) => b[1] - a[1])
        .map(([name, s]) => ({ name, hours: h1(s), pct: allocTotal ? Math.round((s / allocTotal) * 100) : 0 })),
      heatmap, streak, bestStreak: best, trend,
      estimate: {
        count: est.length,
        ratio: estTotal ? Math.round((actTotal / estTotal) * 100) : null, // 100 = perfect, >100 = ran over
        rows: [...eg.values()].sort((a, b) => b.act - a.act).slice(0, 6)
          .map((g) => ({ name: g.name, estimateH: h1(g.est), actualH: h1(g.act), count: g.count })),
      },
    };
  });
}

module.exports = { registerAnalyticsHandlers };
