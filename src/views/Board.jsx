import { useEffect, useMemo, useState } from 'react';
import { Calendar, CheckSquare, Clock, ListFilter, Pause, Play, Repeat, Search, SlidersHorizontal, Sparkles, Trash2, X } from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.jsx';
import { useNow } from '../hooks.js';
import { PRIORITIES, STATUSES, dueInfo, hm, tagStyle } from '../lib.js';
import { Popover, PriorityIcon, Select, StatusDot, Topbar } from '../components/ui.jsx';

function Card({ t, tracked, running, selected, dragging, onPlay, onClick, onDragStart, onDragEnd }) {
  const done = t.subtasks.filter((s) => s.done).length;
  const due = t.status === 'completed' ? null : dueInfo(t.dueDate);
  const over = t.estimateMinutes > 0 && tracked > t.estimateMinutes * 60;
  return (
    <div className={`card ${running ? 'running' : ''} ${t.status === 'completed' ? 'done' : ''} ${dragging ? 'dragging' : ''} ${selected ? 'selected' : ''}`}
      draggable onDragStart={onDragStart} onDragEnd={onDragEnd} onClick={onClick}>
      <div className="card-top">
        <PriorityIcon priority={t.priority} />
        <span className="key">{t.key}</span>
        {t.repeat !== 'none' && <Repeat size={11} className="rep" title={`Repeats ${t.repeat}`} />}
        <button className={`play ${running ? 'on' : ''}`} onClick={(e) => { e.stopPropagation(); onPlay(); }} title={running ? 'Pause timer' : 'Start timer'}>
          {running ? <Pause size={12} /> : <Play size={12} />}
        </button>
      </div>
      <div className="card-title">{t.title}</div>
      {t.status === 'blocked' && t.blockedReason && <div className="reason">{t.blockedReason}</div>}
      <div className="card-foot">
        {t.category && <span className="tag" style={tagStyle(t.category)}>{t.category}</span>}
        <span className="metas">
          {due && <span className={`meta ${due.cls}`}><Calendar size={11} />{due.label}</span>}
          {t.subtasks.length > 0 && <span className="meta"><CheckSquare size={11} />{done}/{t.subtasks.length}</span>}
          {tracked > 0 && <span className={`meta ${running ? 'live' : ''} ${over ? 'over' : ''}`} title={over ? 'Over estimate' : ''}><Clock size={11} />{hm(tracked)}</span>}
        </span>
      </div>
    </div>
  );
}

export default function Board() {
  const { tasks, filters, setFilters, active, startTimer, stopTimer, moveTask, updateTask, deleteTask, setOpenTaskId, notify } = useStore();
  const now = useNow(!!active);
  const [dragId, setDragId] = useState(null);
  const [over, setOver] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [confirmDel, setConfirmDel] = useState(false);
  const [semIds, setSemIds] = useState(null);
  const [semBusy, setSemBusy] = useState(false);

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') { setSelected(new Set()); setConfirmDel(false); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  useEffect(() => { if (!selected.size) setConfirmDel(false); }, [selected]);
  useEffect(() => { if (!filters.q.trim()) setSemIds(null); }, [filters.q]);

  const runSemanticFilter = async () => {
    if (!filters.q.trim()) return;
    setSemBusy(true);
    try {
      const res = await api.ai.semanticSearch(filters.q.trim());
      setSemIds(new Set(res.map((r) => r._id)));
    } catch (e) { notify(e.message); } finally { setSemBusy(false); }
  };

  const visible = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return tasks.filter((t) => {
      const textOk = semIds
        ? semIds.has(t._id)
        : (!q || t.title.toLowerCase().includes(q) || (t.category || '').toLowerCase().includes(q) || t.key.toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q));
      return textOk &&
        (!filters.priorities.length || filters.priorities.includes(t.priority)) &&
        !(filters.hideCompleted && t.status === 'completed');
    });
  }, [tasks, filters, semIds]);

  const columns = STATUSES.filter((s) => !(filters.hideCompleted && s.id === 'completed'));
  const trackedOf = (t) => t.totalTrackedSeconds + (active?.taskId === t._id ? Math.max(0, (now - Date.parse(active.startTime)) / 1000) : 0);

  const togglePri = (id) => setFilters((f) => ({ ...f, priorities: f.priorities.includes(id) ? f.priorities.filter((p) => p !== id) : [...f.priorities, id] }));
  const toggleSel = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const onCardClick = (e, t) => {
    if (e.ctrlKey || e.metaKey || selected.size > 0) toggleSel(t._id);
    else setOpenTaskId(t._id);
  };

  const onDragOver = (e, status) => {
    e.preventDefault();
    const cards = [...e.currentTarget.querySelectorAll('.card:not(.dragging)')];
    let index = cards.findIndex((c) => { const r = c.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
    if (index === -1) index = cards.length;
    if (!over || over.status !== status || over.index !== index) setOver({ status, index });
  };
  const onDrop = (e, status) => {
    e.preventDefault();
    const id = dragId; const index = over?.index;
    setDragId(null); setOver(null);
    if (id) moveTask(id, status, index);
  };

  const bulkMove = async (status) => { const ids = [...selected]; setSelected(new Set()); for (const id of ids) await moveTask(id, status); };
  const bulkPriority = async (priority) => { const ids = [...selected]; setSelected(new Set()); for (const id of ids) await updateTask(id, { priority }); };
  const bulkDelete = async () => { const ids = [...selected]; setSelected(new Set()); for (const id of ids) await deleteTask(id); };

  return (
    <>
      <Topbar title="Kanban Board" meta={`${visible.length} issues${semIds ? ' (semantic)' : ''}`}>
        <label className="search" style={{ width: 300 }}>
          <Search size={14} />
          <input placeholder="Filter by title, notes, or meaning…" value={filters.q}
            onChange={(e) => { setSemIds(null); setFilters({ ...filters, q: e.target.value }); }}
            onKeyDown={(e) => e.key === 'Enter' && filters.q.trim() && runSemanticFilter()} />
          {filters.q.trim() && (
            <button type="button" className="ai-btn" style={{ height: 22, padding: '0 6px' }} disabled={semBusy} onClick={runSemanticFilter} title="Semantic search by meaning (Enter)">
              <Sparkles size={11} />{semBusy ? '…' : semIds ? 'Semantic ✓' : 'AI'}
            </button>
          )}
        </label>
        <Popover icon={<ListFilter size={15} />} active={filters.priorities.length > 0}>
          <h4>PRIORITY</h4>
          {PRIORITIES.map((p) => (
            <button key={p.id} className="check-row" onClick={() => togglePri(p.id)}>
              <span className={`box ${filters.priorities.includes(p.id) ? 'on' : ''}`}>{filters.priorities.includes(p.id) && '✓'}</span>
              <PriorityIcon priority={p.id} /> {p.label}
            </button>
          ))}
        </Popover>
        <Popover icon={<SlidersHorizontal size={15} />} active={filters.hideCompleted}>
          <h4>DISPLAY</h4>
          <button className="check-row" onClick={() => setFilters({ ...filters, hideCompleted: !filters.hideCompleted })}>
            <span className={`box ${filters.hideCompleted ? 'on' : ''}`}>{filters.hideCompleted && '✓'}</span> Hide completed
          </button>
        </Popover>
      </Topbar>

      <div className="view">
        <div className="board">
          {columns.map((col) => {
            const items = visible.filter((t) => t.status === col.id).sort((a, b) => a.order - b.order);
            const showLine = over?.status === col.id;
            const out = []; let n = 0;
            items.forEach((t) => {
              const isDrag = t._id === dragId;
              if (!isDrag) { if (showLine && over.index === n) out.push(<div key="line" className="drop-line" />); n += 1; }
              out.push(
                <Card key={t._id} t={t} tracked={trackedOf(t)} running={active?.taskId === t._id} dragging={isDrag} selected={selected.has(t._id)}
                  onClick={(e) => onCardClick(e, t)}
                  onPlay={() => (active?.taskId === t._id ? stopTimer() : startTimer(t._id))}
                  onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', t._id); setDragId(t._id); }}
                  onDragEnd={() => { setDragId(null); setOver(null); }} />
              );
            });
            if (showLine && over.index >= n) out.push(<div key="line" className="drop-line" />);
            return (
              <section key={col.id} className={`column ${showLine ? 'over' : ''}`}
                onDragOver={(e) => onDragOver(e, col.id)} onDrop={(e) => onDrop(e, col.id)}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(null); }}>
                <div className="col-head"><StatusDot status={col.id} />{col.label}<span className="count">{items.length}</span></div>
                <div className="cards">
                  {out}
                  {items.length === 0 && !showLine && <div className="empty">No issues</div>}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      {selected.size > 0 && (
        <div className="bulk">
          <b>{selected.size} selected</b>
          <Select value="" options={[{ id: '', label: 'Move to…' }, ...STATUSES]} onChange={(s) => s && bulkMove(s)} />
          <Select value="" options={[{ id: '', label: 'Priority…' }, ...PRIORITIES]} onChange={(p) => p && bulkPriority(p)} />
          {confirmDel
            ? <button className="btn danger" onClick={bulkDelete}>Confirm delete</button>
            : <button className="btn danger" onClick={() => setConfirmDel(true)}><Trash2 size={14} />Delete</button>}
          <button className="icon-btn" onClick={() => setSelected(new Set())} title="Clear (Esc)"><X size={14} /></button>
        </div>
      )}
    </>
  );
}
