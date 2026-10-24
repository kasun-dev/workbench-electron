import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { useStore } from '../store.jsx';
import { Modal } from './ui.jsx';

export default function CommandPalette() {
  const { tasks, goals, active, lastTaskId, setView, setPaletteOpen, setCaptureOpen, setOpenTaskId, setOpenGoalId, startTimer, stopTimer } = useStore();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const listRef = useRef(null);
  const close = () => setPaletteOpen(false);

  const items = useMemo(() => {
    const go = (id, label) => ({ label: `Go to ${label}`, hint: 'Navigate', run: () => setView(id) });
    const cmds = [
      go('board', 'Kanban Board'), go('today', 'Today'), go('goals', 'Long-Term Goals'), go('analytics', 'Analytics'),
      go('review', 'Weekly Review'), go('finance', 'Finance'), go('settings', 'Settings'),
      { label: 'New task or goal…', hint: 'Action', run: () => setCaptureOpen(true) },
      { label: 'Toggle floating timer', hint: 'Action', run: () => api.system.toggleMini().catch(() => {}) },
    ];
    if (active) cmds.unshift({ label: `Stop timer (${active.key})`, hint: 'Action', run: () => stopTimer() });
    else if (lastTaskId) cmds.unshift({ label: 'Resume timer on last task', hint: 'Action', run: () => startTimer(lastTaskId) });

    const n = q.trim().toLowerCase();
    const match = (s) => s.toLowerCase().includes(n);
    const taskItems = tasks
      .filter((t) => !n || match(t.title) || match(t.key) || match(t.category || ''))
      .slice(0, 8)
      .map((t) => ({ label: `${t.key}  ${t.title}`, hint: t.category || 'Task', run: () => setOpenTaskId(t._id) }));
    const goalItems = goals.filter((g) => n && match(g.title)).slice(0, 4)
      .map((g) => ({ label: g.title, hint: 'Goal', run: () => setOpenGoalId(g._id) }));
    const cmdItems = n ? cmds.filter((c) => match(c.label)) : cmds;
    return n ? [...taskItems, ...goalItems, ...cmdItems] : [...cmdItems, ...taskItems.slice(0, 4)];
  }, [q, tasks, goals, active, lastTaskId]); // eslint-disable-line

  useEffect(() => setSel(0), [q]);
  useEffect(() => { listRef.current?.children[sel]?.scrollIntoView({ block: 'nearest' }); }, [sel]);

  const exec = (it) => { close(); it?.run(); };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); exec(items[sel]); }
  };

  return (
    <Modal small onClose={close}>
      <input className="pal-input" autoFocus placeholder="Search tasks, goals, or type a command…" value={q}
        onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} />
      <div className="pal-list" ref={listRef}>
        {items.length === 0 && <div className="empty">No matches</div>}
        {items.map((it, i) => (
          <button key={`${it.label}-${i}`} className={`pal-item ${i === sel ? 'sel' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => exec(it)}>
            <span>{it.label}</span><span className="hint">{it.hint}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
