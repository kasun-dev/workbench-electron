// CSV exports (timesheet, finance) and full JSON backup / restore
const { BrowserWindow, dialog } = require('electron');
const fs = require('fs');
const mongoose = require('mongoose');
const { Task, TimeLog, LongTermGoal, Transaction, User } = require('../models');
const state = require('../state');
const { handle, AppError, dateStr } = require('./helpers');
const { stopRunning } = require('./timer');
const { broadcast } = require('../events');

const pad = (n) => String(n).padStart(2, '0');
const d10 = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const t8 = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const hms = (s) => `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;

// CSV-safe (also neutralises spreadsheet formula injection)
const cell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (rows) => `\ufeff${rows.map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;

const parent = (event) => BrowserWindow.fromWebContents(event.sender) || state.mainWindow;

async function saveFile(event, defaultPath, content, name, ext) {
  const r = await dialog.showSaveDialog(parent(event), { defaultPath, filters: [{ name, extensions: [ext] }] });
  if (r.canceled || !r.filePath) return { saved: false };
  await fs.promises.writeFile(r.filePath, content, 'utf8');
  return { saved: true, path: r.filePath };
}

function registerDataHandlers() {
  handle('export:timesheet', async ({ userId, payload, event }) => {
    const from = dateStr(payload.from), to = dateStr(payload.to);
    if (to < from) throw new AppError('The end date is before the start date');
    const start = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T00:00:00`); end.setDate(end.getDate() + 1);
    const logs = await TimeLog.find({ user: userId, isRunning: false, startTime: { $gte: start, $lt: end } }).sort('startTime').lean();
    if (!logs.length) throw new AppError('No tracked time in that date range');
    const tasks = await Task.find({ _id: { $in: [...new Set(logs.map((l) => String(l.task)))] } }).select('key title category discipline').lean();
    const tm = new Map(tasks.map((t) => [String(t._id), t]));
    const rows = [['Date', 'Start', 'End', 'Duration', 'Hours', 'Task', 'Title', 'Category', 'Discipline']];
    let total = 0;
    for (const l of logs) {
      const t = tm.get(String(l.task)) || {};
      total += l.durationSeconds;
      rows.push([d10(l.startTime), t8(l.startTime), t8(l.endTime), hms(l.durationSeconds), (l.durationSeconds / 3600).toFixed(2),
        t.key, t.title, t.category, t.discipline]);
    }
    rows.push(['', '', 'TOTAL', hms(total), (total / 3600).toFixed(2), '', '', '', '']);
    const res = await saveFile(event, `workbench-timesheet-${from}_${to}.csv`, csv(rows), 'CSV', 'csv');
    return { ...res, count: logs.length, hours: Math.round((total / 3600) * 10) / 10 };
  });

  handle('export:finance', async ({ userId, payload, event }) => {
    const month = String(payload.month || '');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new AppError('Invalid month');
    const txs = await Transaction.find({ user: userId, month }).sort({ date: 1 }).lean();
    if (!txs.length) throw new AppError('Nothing to export for this month');
    const rows = [['Date', 'Type', 'Category', 'Savings pot', 'Note', 'Amount', 'Repeats monthly']];
    for (const x of txs) rows.push([x.date, x.type, x.category, x.pot, x.note, x.amount.toFixed(2), x.recurring ? 'yes' : '']);
    const res = await saveFile(event, `workbench-finance-${month}.csv`, csv(rows), 'CSV', 'csv');
    return { ...res, count: txs.length };
  });

  // ---------- backup ----------
  handle('data:backup', async ({ userId, event }) => {
    const [user, tasks, timeLogs, goals, transactions] = await Promise.all([
      User.findById(userId).lean(),
      Task.find({ user: userId }).lean(),
      TimeLog.find({ user: userId }).lean(),
      LongTermGoal.find({ user: userId }).lean(),
      Transaction.find({ user: userId }).lean(),
    ]);
    const data = { app: 'workbench', version: 1, exportedAt: new Date().toISOString(), preferences: user.preferences, tasks, timeLogs, goals, transactions };
    const res = await saveFile(event, `workbench-backup-${d10(new Date())}.json`, JSON.stringify(data, null, 2), 'Workbench backup', 'json');
    return { ...res, counts: { tasks: tasks.length, timeLogs: timeLogs.length, goals: goals.length, transactions: transactions.length } };
  });

  handle('data:restore', async ({ userId, event }) => {
    const win = parent(event);
    const pick = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Workbench backup', extensions: ['json'] }] });
    if (pick.canceled || !pick.filePaths[0]) return { restored: false };
    const stat = await fs.promises.stat(pick.filePaths[0]);
    if (stat.size > 50 * 1024 * 1024) throw new AppError('That file is too large to be a Workbench backup');

    let data;
    try { data = JSON.parse(await fs.promises.readFile(pick.filePaths[0], 'utf8')); } catch { throw new AppError('Could not read that file'); }
    if (!data || data.app !== 'workbench' || data.version !== 1) throw new AppError('This is not a Workbench backup file');
    const arr = (v) => (Array.isArray(v) ? v : []);
    const [bt, bl, bg, bx] = [arr(data.tasks), arr(data.timeLogs), arr(data.goals), arr(data.transactions)];

    const confirm = await dialog.showMessageBox(win, {
      type: 'warning', buttons: ['Replace my data', 'Cancel'], defaultId: 1, cancelId: 1, title: 'Restore backup',
      message: 'Replace ALL current tasks, time logs, goals and finance data with this backup?',
      detail: `Backup contains ${bt.length} tasks, ${bl.length} time logs, ${bg.length} goals and ${bx.length} transactions.\nThis cannot be undone.`,
    });
    if (confirm.response !== 0) return { restored: false };

    // Build + validate everything BEFORE deleting anything, with fresh ids
    const ids = new Map();
    const nid = (old) => { const k = String(old); if (!ids.has(k)) ids.set(k, new mongoose.Types.ObjectId()); return ids.get(k); };
    const taskIds = new Set(bt.map((t) => String(t._id)));
    const sub = (a) => arr(a).map((x) => ({ title: x.title, done: !!x.done }));

    const goals = bg.map((g) => ({
      _id: nid(g._id), user: userId, title: g.title, description: g.description, category: g.category, discipline: g.discipline,
      priority: g.priority, status: g.status, targetDate: g.targetDate || null, milestones: sub(g.milestones),
      promotedTasks: arr(g.promotedTasks).filter((id) => taskIds.has(String(id))).map(nid),
    }));
    const tasks = bt.map((t) => ({
      _id: nid(t._id), user: userId, key: t.key, title: t.title, description: t.description, status: t.status, category: t.category,
      discipline: t.discipline, priority: t.priority, order: t.order, subtasks: sub(t.subtasks),
      timeLogs: arr(t.timeLogs).map(nid), totalTrackedSeconds: t.totalTrackedSeconds || 0, estimateMinutes: t.estimateMinutes || 0,
      completedAt: t.completedAt || null, goal: t.goal ? nid(t.goal) : null, dueDate: t.dueDate || null,
      blockedReason: t.blockedReason || '', repeat: t.repeat || 'none', spawnedNext: !!t.spawnedNext,
    }));
    const logs = bl.filter((l) => taskIds.has(String(l.task))).map((l) => ({
      _id: nid(l._id), user: userId, task: nid(l.task), startTime: l.startTime, endTime: l.endTime || l.startTime,
      durationSeconds: l.durationSeconds || 0, isRunning: false, manual: !!l.manual,
    }));
    const txs = bx.map((x) => ({
      user: userId, type: x.type, amount: x.amount, category: x.category, note: x.note, pot: x.pot, date: x.date,
      month: String(x.date || '').slice(0, 7), recurring: !!x.recurring,
    }));

    const bad = [
      ...tasks.map((d) => new Task(d)), ...logs.map((d) => new TimeLog(d)),
      ...goals.map((d) => new LongTermGoal(d)), ...txs.map((d) => new Transaction(d)),
    ].find((doc) => doc.validateSync());
    if (bad) throw new AppError('The backup file contains invalid data, nothing was changed');

    await stopRunning(userId);
    await Promise.all([Task.deleteMany({ user: userId }), TimeLog.deleteMany({ user: userId }), LongTermGoal.deleteMany({ user: userId }), Transaction.deleteMany({ user: userId })]);
    if (tasks.length) await Task.insertMany(tasks);
    if (logs.length) await TimeLog.insertMany(logs);
    if (goals.length) await LongTermGoal.insertMany(goals);
    if (txs.length) await Transaction.insertMany(txs);

    const maxKey = Math.max(100, ...tasks.map((t) => Number(String(t.key).replace(/\D/g, '')) || 0));
    const me = await User.findById(userId).select('taskSeq');
    await User.updateOne({ _id: userId }, { taskSeq: Math.max(me.taskSeq, maxKey) });
    broadcast('timer:changed');
    return { restored: true, counts: { tasks: tasks.length, timeLogs: logs.length, goals: goals.length, transactions: txs.length } };
  });
}

module.exports = { registerDataHandlers };
