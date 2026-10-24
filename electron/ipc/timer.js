const { Task, TimeLog } = require('../models');
const { handle, AppError, oid } = require('./helpers');
const { setTimerStatus } = require('../tray');
const { broadcast } = require('../events');

// Closes the user's running log. Timestamps come from the MAIN process clock.
// `endAt` lets the idle dialog stop the timer back at the moment the user walked away.
async function stopRunning(userId, onlyTaskId = null, endAt = null) {
  const filter = { user: userId, isRunning: true };
  if (onlyTaskId) filter.task = onlyTaskId;
  const log = await TimeLog.findOne(filter);
  if (!log) return null;

  let end = new Date();
  if (endAt) { const e = new Date(endAt); if (!Number.isNaN(e.getTime()) && e < end) end = e; }

  if (end <= log.startTime) { // nothing worth keeping
    await Task.updateOne({ _id: log.task }, { $pull: { timeLogs: log._id } });
    await log.deleteOne();
    setTimerStatus(null);
    return { _id: log._id, task: log.task, discarded: true };
  }
  log.endTime = end;
  log.durationSeconds = Math.max(0, Math.round((end - log.startTime) / 1000));
  log.isRunning = false;
  await log.save();
  await Task.updateOne({ _id: log.task }, { $inc: { totalTrackedSeconds: log.durationSeconds } });
  setTimerStatus(null);
  return log.toObject();
}

async function startTimerFor(userId, taskId) {
  const task = await Task.findOne({ _id: oid(taskId), user: userId });
  if (!task) throw new AppError('Task not found', 'NOT_FOUND');
  await stopRunning(userId); // one timer at a time (the DB index enforces it too)
  const log = await TimeLog.create({ user: userId, task: task._id, startTime: new Date(), isRunning: true });
  task.timeLogs.push(log._id);
  if (['backlog', 'up_next'].includes(task.status)) task.status = 'in_progress';
  await task.save();
  setTimerStatus(`${task.key} ${task.title}`);
  return { log: log.toObject(), task: task.toObject() };
}

// Used by the tray, the global shortcut and the floating timer
async function toggleTimer(userId) {
  if (await TimeLog.exists({ user: userId, isRunning: true })) {
    await stopRunning(userId);
    broadcast('timer:changed');
    return { running: false };
  }
  const last = await TimeLog.findOne({ user: userId }).sort('-startTime').select('task').lean();
  const task = last && (await Task.findOne({ _id: last.task, user: userId }).select('status'));
  if (!task || task.status === 'completed') return { running: false, reason: 'no-task' };
  await startTimerFor(userId, task._id);
  broadcast('timer:changed');
  return { running: true };
}

function registerTimerHandlers() {
  handle('timer:start', async ({ userId, payload }) => {
    const r = await startTimerFor(userId, payload.taskId);
    broadcast('timer:changed');
    return r;
  });

  handle('timer:stop', async ({ userId, payload }) => {
    const log = await stopRunning(userId, null, payload.endAt || null);
    broadcast('timer:changed');
    if (!log) return null;
    return { log, task: await Task.findById(log.task).lean() };
  });

  handle('timer:toggle', async ({ userId }) => toggleTimer(userId));

  handle('timer:active', async ({ userId }) => {
    const log = await TimeLog.findOne({ user: userId, isRunning: true }).lean();
    if (!log) { setTimerStatus(null); return null; }
    const task = await Task.findById(log.task).select('key title').lean();
    setTimerStatus(`${task.key} ${task.title}`);
    return { log, task };
  });
}

module.exports = { registerTimerHandlers, stopRunning, startTimerFor, toggleTimer };
