const { Task, TimeLog, User, LongTermGoal } = require('../models');
const { handle } = require('./helpers');

const DAY = 864e5;
const h1 = (s) => Math.round((s / 3600) * 10) / 10;
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function registerReviewHandlers() {
  handle('review:summary', async ({ userId }) => {
    const now = new Date();
    const since = new Date(now.getTime() - 7 * DAY);
    const prev = new Date(now.getTime() - 14 * DAY);
    const today = ymd(now);

    const [user, completed, logs, prevLogs, blocked, overdue, staleGoals] = await Promise.all([
      User.findById(userId).select('preferences.weeklyPlan').lean(),
      Task.find({ user: userId, status: 'completed', completedAt: { $gte: since } }).sort('-completedAt').select('key title category completedAt totalTrackedSeconds').lean(),
      TimeLog.find({ user: userId, startTime: { $gte: since } }).select('task startTime durationSeconds isRunning').lean(),
      TimeLog.find({ user: userId, isRunning: false, startTime: { $gte: prev, $lt: since } }).select('durationSeconds').lean(),
      Task.find({ user: userId, status: 'blocked' }).select('key title category blockedReason').lean(),
      Task.find({ user: userId, status: { $ne: 'completed' }, dueDate: { $ne: null, $lt: today } }).sort('dueDate').limit(10).select('key title category dueDate').lean(),
      LongTermGoal.find({ user: userId, status: 'someday', createdAt: { $lte: new Date(now.getTime() - 30 * DAY) }, promotedTasks: { $size: 0 } })
        .sort('createdAt').limit(5).select('title category createdAt').lean(),
    ]);

    const secs = (l) => (l.isRunning ? Math.max(0, Math.round((now - l.startTime) / 1000)) : l.durationSeconds);
    const tasks = await Task.find({ _id: { $in: [...new Set(logs.map((l) => String(l.task)))] } }).select('category').lean();
    const cat = new Map(tasks.map((t) => [String(t._id), t.category || 'Uncategorised']));
    const by = new Map();
    let total = 0;
    for (const l of logs) { const s = secs(l); total += s; const k = cat.get(String(l.task)) || 'Uncategorised'; by.set(k, (by.get(k) || 0) + s); }

    const plan = user?.preferences?.weeklyPlan?.length === 7 ? user.preferences.weeklyPlan : [8, 8, 8, 8, 6, 3, 0];
    const planned = plan.reduce((a, b) => a + b, 0);
    return {
      since,
      totalHours: h1(total),
      prevHours: h1(prevLogs.reduce((a, l) => a + l.durationSeconds, 0)),
      sessions: logs.length,
      plannedWeek: planned,
      accuracy: planned ? Math.round((total / 3600 / planned) * 100) : 0,
      completed,
      byCategory: [...by.entries()].sort((a, b) => b[1] - a[1]).map(([name, s]) => ({ name, hours: h1(s) })),
      blocked, overdue, staleGoals,
    };
  });
}

module.exports = { registerReviewHandlers };
