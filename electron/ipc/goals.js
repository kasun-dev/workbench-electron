const { LongTermGoal, Task, GOAL_STATUSES, PRIORITIES } = require('../models');
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

function registerGoalHandlers() {
  // Each goal also reports progress from its promoted tasks (done count + time actually tracked)
  handle('goals:list', async ({ userId }) => {
    const goals = await LongTermGoal.find({ user: userId }).sort({ status: 1, createdAt: -1 }).lean();
    const ids = goals.flatMap((g) => g.promotedTasks);
    const tasks = ids.length ? await Task.find({ _id: { $in: ids } }).select('status totalTrackedSeconds').lean() : [];
    const map = new Map(tasks.map((t) => [String(t._id), t]));
    return goals.map((g) => {
      const ts = g.promotedTasks.map((id) => map.get(String(id))).filter(Boolean);
      return {
        ...g,
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
    return g.toObject();
  });
  handle('goals:delete', async ({ userId, payload }) => {
    const g = await mine(userId, payload.id);
    await g.deleteOne(); // promoted tasks are real work history and are kept
    return { id: String(g._id) };
  });

  // Promote: goal -> real Kanban task. Unfinished milestones become sub-tasks.
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
