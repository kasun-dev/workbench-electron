const { Task, TimeLog } = require('../models');
const { handle, AppError, oid, when } = require('./helpers');

const DAY = 864e5;

function range(startTime, endTime) {
  const start = when(startTime), end = when(endTime);
  if (end <= start) throw new AppError('End time must be after start time');
  if (end - start > DAY) throw new AppError('A single entry can be at most 24 hours');
  if (end.getTime() > Date.now() + 60000) throw new AppError('End time is in the future');
  if (start.getFullYear() < 2000) throw new AppError('Invalid start time');
  return { start, end, seconds: Math.round((end - start) / 1000) };
}

// Single source of truth: total = sum of all finished logs
async function recalc(taskId) {
  const logs = await TimeLog.find({ task: taskId, isRunning: false }).select('durationSeconds').lean();
  const total = logs.reduce((a, l) => a + l.durationSeconds, 0);
  await Task.updateOne({ _id: taskId }, { totalTrackedSeconds: total });
  return total;
}

function registerTimeLogHandlers() {
  handle('timelogs:create', async ({ userId, payload }) => {
    const task = await Task.findOne({ _id: oid(payload.taskId), user: userId });
    if (!task) throw new AppError('Task not found', 'NOT_FOUND');
    const { start, end, seconds } = range(payload.startTime, payload.endTime);
    const log = await TimeLog.create({ user: userId, task: task._id, startTime: start, endTime: end, durationSeconds: seconds, isRunning: false, manual: true });
    task.timeLogs.push(log._id);
    await task.save();
    return { log: log.toObject(), totalTrackedSeconds: await recalc(task._id) };
  });

  handle('timelogs:update', async ({ userId, payload }) => {
    const log = await TimeLog.findOne({ _id: oid(payload.id), user: userId });
    if (!log) throw new AppError('Entry not found', 'NOT_FOUND');
    if (log.isRunning) throw new AppError('Stop the timer before editing this entry');
    const { start, end, seconds } = range(payload.startTime, payload.endTime);
    Object.assign(log, { startTime: start, endTime: end, durationSeconds: seconds, manual: true });
    await log.save();
    return { log: log.toObject(), totalTrackedSeconds: await recalc(log.task) };
  });

  handle('timelogs:delete', async ({ userId, payload }) => {
    const log = await TimeLog.findOne({ _id: oid(payload.id), user: userId });
    if (!log) throw new AppError('Entry not found', 'NOT_FOUND');
    if (log.isRunning) throw new AppError('Stop the timer before deleting this entry');
    await Task.updateOne({ _id: log.task }, { $pull: { timeLogs: log._id } });
    await log.deleteOne();
    return { totalTrackedSeconds: await recalc(log.task) };
  });
}

module.exports = { registerTimeLogHandlers };
