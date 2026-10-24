import { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.jsx';
import { Modal } from './ui.jsx';

export default function CommandPalette() {
  const { tasks, goals, active, lastTaskId, setView, setPaletteOpen, setCaptureOpen, setOpenTaskId, setOpenGoalId, startTimer, stopTimer, notify } = useStore();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [aiAnswer, setAiAnswer] = useState('');
  const [semMatches, setSemMatches] = useState([]);
  const [busy, setBusy] = useState(false);
  const listRef = useRef(null);
  const close = () => setPaletteOpen(false);

  const askAi = async (question) => {
    setBusy(true); setAiAnswer('');
    try {
      const r = await api.ai.askData(question);
      setAiAnswer(r.answer);
    } catch (e) { notify(e.message); } finally { setBusy(false); }
  };

  const runSemantic = async (query) => {
    setBusy(true);
    try { setSemMatches(await api.ai.semanticSearch(query)); }
    catch (e) { notify(e.message); } finally { setBusy(false); }
  };

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
    const strip = (s = '') => s.replace(/<[^>]+>/g, ' ');
    const taskItems = tasks
      .filter((t) => !n || match(t.title) || match(t.key) || match(t.category || '') || match(strip(t.description)))
      .slice(0, 8)
      .map((t) => ({ label: `${t.key}  ${t.title}`, hint: t.category || 'Task', run: () => { close(); setOpenTaskId(t._id); } }));
    const goalItems = goals.filter((g) => n && match(g.title)).slice(0, 4)
      .map((g) => ({ label: g.title, hint: 'Goal', run: () => { close(); setOpenGoalId(g._id); } }));
    const cmdItems = n ? cmds.filter((c) => match(c.label)).map((c) => ({ ...c, run: () => { close(); c.run(); } })) : cmds.map((c) => ({ ...c, run: () => { close(); c.run(); } }));

    const aiItems = n.length >= 2 ? [
      { label: `✨ Ask AI: "${q.trim()}"`, hint: 'Ask Your Data', keepOpen: true, run: () => askAi(q.trim()) },
      { label: `🔍 Semantic search: "${q.trim()}"`, hint: 'By Meaning', keepOpen: true, run: () => runSemantic(q.trim()) },
    ] : [];

    const semItems = semMatches.map((m) => ({
      label: `${m.key}  ${m.title}`,
      hint: `Semantic ${Math.round(m.score * 100)}% · ${m.category || m.status}`,
      run: () => { close(); setOpenTaskId(m._id); },
    }));

    return n ? [...aiItems, ...semItems, ...taskItems, ...goalItems, ...cmdItems] : [...cmdItems, ...taskItems.slice(0, 4)];
  }, [q, tasks, goals, active, lastTaskId, semMatches]); // eslint-disable-line

  useEffect(() => { setSel(0); setSemMatches([]); setAiAnswer(''); }, [q]);
  useEffect(() => { listRef.current?.children[sel]?.scrollIntoView({ block: 'nearest' }); }, [sel]);

  const exec = (it) => { if (!it) return; it.run(); };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); exec(items[sel]); }
  };

  return (
    <Modal small onClose={close}>
      <input className="pal-input" autoFocus placeholder='Search tasks, or ask AI ("How many hours on Axceera this month?")…' value={q}
        onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} />
      {(busy || aiAnswer) && (
        <div className="ai-box" style={{ margin: 10 }}>
          <h4><Sparkles size={13} /> {busy ? 'Querying your data…' : 'Workbench AI Answer'}</h4>
          {aiAnswer && <div style={{ fontSize: 13, lineHeight: 1.5 }}>{aiAnswer}</div>}
        </div>
      )}
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
