import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

const Ctx = createContext(null);
export const useStore = () => useContext(Ctx);

const byOrder = (a, b) => a.order - b.order;
const toActive = (log, task) => ({
  logId: log._id, taskId: String(log.task), startTime: log.startTime, key: task.key, title: task.title,
});

export function StoreProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = booting, null = signed out
  const [tasks, setTasks] = useState([]);
  const [goals, setGoals] = useState([]);
  const [active, setActive] = useState(null);  // running timer
  const [lastTaskId, setLastTaskId] = useState(null);
  const [view, setView] = useState('board');
  const [openTaskId, setOpenTaskId] = useState(null);
  const [openGoalId, setOpenGoalId] = useState(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [idle, setIdle] = useState(null);      // { since, idleSeconds } from the idle detector
  const [filters, setFilters] = useState({ q: '', priorities: [], hideCompleted: false });
  const [toast, setToast] = useState(null);
  const toastTimer = useRef();

  const notify = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);
  const run = useCallback(async (fn) => {
    try { return await fn(); } catch (e) { notify(e.message || 'Something went wrong'); return undefined; }
  }, [notify]);

  const loadAll = useCallback(async () => {
    const [t, g, a] = await Promise.all([api.tasks.list(), api.goals.list(), api.timer.active()]);
    setTasks(t); setGoals(g);
    setActive(a ? toActive(a.log, a.task) : null);
  }, []);

  // lightweight resync after the timer was changed elsewhere (tray, shortcut, floating timer)
  const refreshTimer = useCallback(async () => {
    const [t, a] = await Promise.all([api.tasks.list(), api.timer.active()]);
    setTasks(t);
    setActive(a ? toActive(a.log, a.task) : null);
  }, []);

  const reset = () => { setTasks([]); setGoals([]); setActive(null); setOpenTaskId(null); setOpenGoalId(null); setView('board'); };

  useEffect(() => {
    api.auth.session()
      .then(async (u) => { setUser(u); if (u) await loadAll(); })
      .catch((e) => { setUser(null); notify(e.message); });
  }, [loadAll, notify]);

  // events pushed from the main process
  useEffect(() => {
    if (!user) return undefined;
    const offs = [
      api.events.on('timer:changed', () => { refreshTimer().catch(() => {}); }),
      api.events.on('idle:prompt', (p) => setIdle(p)),
      api.events.on('cmd:capture', () => setCaptureOpen(true)),
    ];
    return () => offs.forEach((off) => off && off());
  }, [user, refreshTimer]);

  // ---------- auth ----------
  const login = async (email, password) => { const u = await api.auth.login({ email, password }); setUser(u); await loadAll(); };
  const register = async (d) => { const u = await api.auth.register(d); reset(); setUser(u); };
  const logout = async () => {
    await api.timer.stop().catch(() => {});
    await api.auth.logout();
    reset(); setUser(null);
  };

  // ---------- tasks ----------
  const replaceTask = (t) => setTasks((ts) => (ts.some((x) => x._id === t._id) ? ts.map((x) => (x._id === t._id ? t : x)) : [...ts, t]));
  const patchTask = (id, changes) => setTasks((ts) => ts.map((t) => (t._id === id ? { ...t, ...changes } : t)));

  const createTask = (data) => run(async () => {
    const t = await api.tasks.create(data);
    setTasks((ts) => [...ts, t]);
    return t;
  });

  const updateTask = (id, changes) => {
    patchTask(id, changes);
    return run(async () => replaceTask(await api.tasks.update(id, changes)));
  };

  const moveTask = (id, status, index) => {
    setTasks((ts) => {
      const t = ts.find((x) => x._id === id);
      if (!t) return ts;
      const others = ts.filter((x) => x._id !== id);
      const col = others.filter((x) => x.status === status).sort(byOrder);
      const at = index == null ? col.length : Math.min(index, col.length);
      col.splice(at, 0, { ...t, status });
      return [...others.filter((x) => x.status !== status), ...col.map((x, i) => ({ ...x, order: i }))];
    });
    if (status === 'completed') setActive((a) => (a && a.taskId === id ? null : a));
    return run(async () => {
      const r = await api.tasks.move(id, status, index);
      replaceTask(r.task);
      if (r.spawned) { replaceTask(r.spawned); notify(`Next ${r.spawned.repeat} copy created: ${r.spawned.key}`); }
    });
  };

  const deleteTask = (id) => {
    setTasks((ts) => ts.filter((t) => t._id !== id));
    setActive((a) => (a && a.taskId === id ? null : a));
    setOpenTaskId(null);
    return run(() => api.tasks.delete(id));
  };

  // ---------- timer ----------
  const startTimer = (taskId) => run(async () => {
    const { log, task } = await api.timer.start(taskId);
    replaceTask(task);
    setActive(toActive(log, task));
    setLastTaskId(task._id);
  });
  const stopTimer = (endAt) => run(async () => {
    const r = await api.timer.stop(endAt);
    if (r) { replaceTask(r.task); setLastTaskId(r.task._id); }
    setActive(null);
  });

  // answer from the "you were away" dialog
  const resolveIdle = async (action) => {
    const prompt = idle; const taskId = active?.taskId;
    setIdle(null);
    if (!prompt || action === 'keep' || !taskId) return;
    await stopTimer(prompt.since);
    if (action === 'discard_continue') await startTimer(taskId);
  };

  // ---------- goals ----------
  const createGoal = (d) => run(async () => {
    const g = await api.goals.create(d);
    setGoals((gs) => [g, ...gs]);
    return g;
  });
  const updateGoal = (id, ch) => {
    setGoals((gs) => gs.map((g) => (g._id === id ? { ...g, ...ch } : g)));
    return run(async () => { const g = await api.goals.update(id, ch); setGoals((gs) => gs.map((x) => (x._id === id ? { ...x, ...g } : x))); });
  };
  const deleteGoal = (id) => run(async () => {
    await api.goals.delete(id);
    setGoals((gs) => gs.filter((g) => g._id !== id));
    setOpenGoalId(null);
  });
  const promoteGoal = (id, status) => run(async () => {
    const { goal, task } = await api.goals.promote(id, status);
    setGoals((gs) => gs.map((g) => (g._id === id ? { ...g, ...goal, tasksTotal: (g.tasksTotal || 0) + 1 } : g)));
    setTasks((ts) => [...ts, task]);
    notify(`Promoted to ${task.key} (${status === 'backlog' ? 'Backlog' : 'Up Next'})`);
    return task;
  });

  const value = {
    user, setUser, tasks, goals, active, lastTaskId, view, setView, filters, setFilters,
    openTaskId, setOpenTaskId, openGoalId, setOpenGoalId, captureOpen, setCaptureOpen, paletteOpen, setPaletteOpen,
    idle, resolveIdle, toast, notify, loadAll, login, register, logout,
    createTask, updateTask, patchTask, moveTask, deleteTask, startTimer, stopTimer,
    createGoal, updateGoal, deleteGoal, promoteGoal,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
