const { LongTermGoal, Task, Transaction, GOAL_STATUSES, PRIORITIES } = require('../models');
const { handle, AppError, str, oneOf, oid } = require('./helpers');
const { createTask } = require('./tasks');

function pickGoalFields(p) {
  const out = {};
  if (p.title !== undefined) out.title = str(p.title, { max: 200, required: true });
  if (p.description !== undefined) out.description = str(p.description, { max: 20000 });
  if (p.category !== undefined) out.category = str(p.category, { max: 60 });
  if (p.discipline !== undefined) out.discipline = str(p.discipline, { max: 60 });
  if (p.priority !== undefined) out.priority = oneOf(p.priority, PRIORITIES);
  if (p.status !== undefined) out.status = oneOf(p.status, GOAL_STATUSES);
  if (p.targetDate !== undefined) out.targetDate = p.targetDate ? new Date(p.targetDate) : null;
  if (p.targetCost !== undefined) {
    const c = Number(p.targetCost);
    out.targetCost = Number.isFinite(c) && c >= 0 ? Math.round(c * 100) / 100 : 0;
  }
  if (p.linkedPot !== undefined) out.linkedPot = str(p.linkedPot, { max: 60 });
  if (p.milestones !== undefined) {
    if (!Array.isArray(p.milestones) || p.milestones.length > 100) throw new AppError('Invalid milestones');
    out.milestones = p.milestones.map((m) => ({
      ...(m._id && /^[a-f\d]{24}$/i.test(m._id) ? { _id: m._id } : {}),
      title: str(m.title, { max: 200, required: true }), done: !!m.done,
    }));
  }
  return out;
}

const mine = async (userId, id) => {
  const g = await LongTermGoal.findOne({ _id: oid(id), user: userId });
  if (!g) throw new AppError('Goal not found', 'NOT_FOUND');
  return g;
};

async function potMapFor(userId) {
  const saved = await Transaction.find({ user: userId, type: 'saving' }).select('amount pot').lean();
  const pots = new Map();
  for (const x of saved) {
    const k = (x.pot || 'General').toLowerCase();
    pots.set(k, (pots.get(k) || 0) + Math.round(x.amount * 100));
  }
  return pots;
}

function registerGoalHandlers() {
  handle('goals:list', async ({ userId }) => {
    const [goals, pots] = await Promise.all([
      LongTermGoal.find({ user: userId }).sort({ status: 1, createdAt: -1 }).lean(),
      potMapFor(userId),
    ]);
    const ids = goals.flatMap((g) => g.promotedTasks);
    const tasks = ids.length ? await Task.find({ _id: { $in: ids } }).select('status totalTrackedSeconds').lean() : [];
    const map = new Map(tasks.map((t) => [String(t._id), t]));
    return goals.map((g) => {
      const ts = g.promotedTasks.map((id) => map.get(String(id))).filter(Boolean);
      const potSaved = g.linkedPot ? (pots.get(g.linkedPot.toLowerCase()) || 0) / 100 : 0;
      return {
        ...g,
        potSaved,
        trackedSeconds: ts.reduce((a, t) => a + t.totalTrackedSeconds, 0),
        tasksDone: ts.filter((t) => t.status === 'completed').length,
        tasksTotal: ts.length,
      };
    });
  });

  handle('goals:create', async ({ userId, payload }) =>
    (await LongTermGoal.create({ title: 'Untitled goal', ...pickGoalFields(payload), user: userId })).toObject());

  handle('goals:update', async ({ userId, payload }) => {
    const g = await mine(userId, payload.id);
    Object.assign(g, pickGoalFields(payload.changes || {}));
    await g.save();
    const pots = await potMapFor(userId);
    const obj = g.toObject();
    obj.potSaved = obj.linkedPot ? (pots.get(obj.linkedPot.toLowerCase()) || 0) / 100 : 0;
    return obj;
  });

  handle('goals:delete', async ({ userId, payload }) => {
    const g = await mine(userId, payload.id);
    await g.deleteOne();
    return { id: String(g._id) };
  });

  handle('goals:promote', async ({ userId, payload }) => {
    const g = await mine(userId, payload.id);
    if (['achieved', 'archived'].includes(g.status)) throw new AppError('Reopen this goal before promoting it');
    const status = payload.status === 'backlog' ? 'backlog' : 'up_next';
    const task = await createTask(userId, {
      title: g.title, description: g.description, category: g.category,
      discipline: g.discipline, priority: g.priority, status,
      subtasks: g.milestones.filter((m) => !m.done).map((m) => ({ title: m.title, done: false })),
    }, { goal: g._id });
    g.promotedTasks.push(task._id);
    g.status = 'in_motion';
    await g.save();
    return { goal: g.toObject(), task: task.toObject() };
  });
}

module.exports = { registerGoalHandlers };
