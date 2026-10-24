const { Task, TimeLog, User, STATUSES, PRIORITIES, REPEATS } = require('../models');
const { handle, AppError, str, oneOf, oid, int, dateStr } = require('./helpers');
const { stopRunning } = require('./timer');
const { broadcast } = require('../events');

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function nextDue(due, repeat) {
  const today = ymd(new Date());
  const d = new Date(`${due && due > today ? due : today}T12:00:00`);
  if (repeat === 'daily') d.setDate(d.getDate() + 1);
  else if (repeat === 'weekly') d.setDate(d.getDate() + 7);
  else d.setMonth(d.getMonth() + 1);
  return ymd(d);
}

function cleanSubtasks(list) {
  if (!Array.isArray(list) || list.length > 100) throw new AppError('Invalid sub-tasks');
  return list.map((s) => ({
    ...(s._id && /^[a-f\d]{24}$/i.test(s._id) ? { _id: s._id } : {}),
    title: str(s.title, { max: 200, required: true }),
    done: !!s.done,
  }));
}

// Whitelist: the renderer can never write user, key, timeLogs, totals, etc.
function pickTaskFields(p) {
  const out = {};
  if (p.title !== undefined) out.title = str(p.title, { max: 200, required: true });
  if (p.description !== undefined) out.description = str(p.description, { max: 20000 });
  if (p.category !== undefined) out.category = str(p.category, { max: 60 });
  if (p.discipline !== undefined) out.discipline = str(p.discipline, { max: 60 });
  if (p.priority !== undefined) out.priority = oneOf(p.priority, PRIORITIES);
  if (p.estimateMinutes !== undefined) out.estimateMinutes = int(p.estimateMinutes, 0, 100000);
  if (p.subtasks !== undefined) out.subtasks = cleanSubtasks(p.subtasks);
  if (p.dueDate !== undefined) out.dueDate = p.dueDate ? dateStr(p.dueDate) : null;
  if (p.blockedReason !== undefined) out.blockedReason = str(p.blockedReason, { max: 300 });
  if (p.repeat !== undefined) out.repeat = oneOf(p.repeat, REPEATS);
  return out;
}

// Shared with the goals handler (promotion) and recurring tasks
async function createTask(userId, data, extra = {}) {
  const fields = pickTaskFields(data);
  const status = data.status === undefined ? 'backlog' : oneOf(data.status, STATUSES);
  const { taskSeq } = await User.findByIdAndUpdate(userId, { $inc: { taskSeq: 1 } }, { new: true, select: 'taskSeq' }).lean();
  const last = await Task.findOne({ user: userId, status }).sort('-order').select('order').lean();
  return Task.create({
    title: 'Untitled task', ...fields, ...extra,
    user: userId, key: `WRK-${taskSeq}`, status, order: last ? last.order + 1 : 0,
  });
}

const mine = async (userId, id) => {
  const task = await Task.findOne({ _id: oid(id), user: userId });
  if (!task) throw new AppError('Task not found', 'NOT_FOUND');
  return task;
};

function registerTaskHandlers() {
  handle('tasks:list', ({ userId }) => Task.find({ user: userId }).sort({ status: 1, order: 1 }).lean());

  handle('tasks:get', async ({ userId, payload }) => {
    const task = await Task.findOne({ _id: oid(payload.id), user: userId })
      .populate({ path: 'timeLogs', options: { sort: { startTime: 1 } } }).lean();
    if (!task) throw new AppError('Task not found', 'NOT_FOUND');
    return task;
  });

  handle('tasks:create', async ({ userId, payload }) => (await createTask(userId, payload)).toObject());

  handle('tasks:update', async ({ userId, payload }) => {
    const task = await mine(userId, payload.id);
    Object.assign(task, pickTaskFields(payload.changes || {}));
    await task.save();
    return task.toObject();
  });

  // Drag & drop / status dropdown. Returns { task, spawned } (spawned = next copy of a recurring task)
  handle('tasks:move', async ({ userId, payload }) => {
    const status = oneOf(payload.status, STATUSES);
    const task = await mine(userId, payload.id);

    const column = await Task.find({ user: userId, status, _id: { $ne: task._id } }).sort('order').select('_id').lean();
    const at = payload.index == null ? column.length : Math.min(Math.max(int(payload.index, 0, 100000), 0), column.length);
    column.splice(at, 0, { _id: task._id });

    let spawned = null;
    if (status === 'completed' && task.repeat !== 'none' && !task.spawnedNext) {
      spawned = await createTask(userId, {
        title: task.title, description: task.description, category: task.category, discipline: task.discipline,
        priority: task.priority, estimateMinutes: task.estimateMinutes, repeat: task.repeat,
        dueDate: nextDue(task.dueDate, task.repeat), status: 'up_next',
        subtasks: task.subtasks.map((s) => ({ title: s.title, done: false })),
      });
      task.spawnedNext = true;
    }

    task.status = status;
    task.completedAt = status === 'completed' ? task.completedAt || new Date() : null;
    if (status !== 'blocked') task.blockedReason = '';
    await task.save();
    await Task.bulkWrite(column.map((c, i) => ({ updateOne: { filter: { _id: c._id }, update: { $set: { order: i } } } })));

    if (status === 'completed' && (await stopRunning(userId, task._id))) broadcast('timer:changed');
    return { task: await Task.findById(task._id).lean(), spawned: spawned ? spawned.toObject() : null };
  });

  handle('tasks:delete', async ({ userId, payload }) => {
    const task = await mine(userId, payload.id);
    if (await stopRunning(userId, task._id)) broadcast('timer:changed');
    await TimeLog.deleteMany({ task: task._id });
    await task.deleteOne();
    return { id: String(task._id) };
  });
}

module.exports = { registerTaskHandlers, createTask };
