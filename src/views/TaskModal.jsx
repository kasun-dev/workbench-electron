import { useEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { Bold, Check, Code, Italic, Link2, List, Pause, Pencil, Play, Plus, Trash2, X } from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.jsx';
import { useNow } from '../hooks.js';
import { PRIORITIES, REPEATS, STATUSES, fmtDateTime, fromLocalInput, hms, tagStyle, toLocalInput } from '../lib.js';
import { Modal, PriorityIcon, Select } from '../components/ui.jsx';

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function RichEditor({ html, onCommit }) {
  const ref = useRef(null);
  const dirty = useRef(false);
  const timer = useRef();
  const range = useRef(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [url, setUrl] = useState('');

  useEffect(() => { ref.current.innerHTML = DOMPurify.sanitize(html || ''); }, []); // eslint-disable-line
  const commit = () => {
    clearTimeout(timer.current);
    if (!dirty.current) return;
    dirty.current = false;
    onCommit(DOMPurify.sanitize(ref.current.innerHTML));
  };
  useEffect(() => () => commit(), []); // eslint-disable-line  (flush on close)
  const touch = () => { dirty.current = true; clearTimeout(timer.current); timer.current = setTimeout(commit, 700); };
  const exec = (cmd, val) => { ref.current.focus(); document.execCommand(cmd, false, val); touch(); };
  const keep = (e) => e.preventDefault(); // keep the text selection when clicking toolbar buttons

  const inlineCode = () => {
    const text = window.getSelection().toString();
    if (text) exec('insertHTML', `<code>${esc(text)}</code>`);
  };
  const openLink = () => {
    const sel = window.getSelection();
    range.current = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    setLinkOpen(true);
  };
  const applyLink = (e) => {
    e.preventDefault();
    let u = url.trim();
    if (u) {
      if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
      ref.current.focus();
      const sel = window.getSelection(); sel.removeAllRanges(); if (range.current) sel.addRange(range.current);
      document.execCommand('createLink', false, u); touch();
    }
    setUrl(''); setLinkOpen(false);
  };

  return (
    <div className="editor">
      <div className="toolbar">
        <button type="button" className="tb" onMouseDown={keep} onClick={() => exec('bold')} title="Bold"><Bold size={14} /></button>
        <button type="button" className="tb" onMouseDown={keep} onClick={() => exec('italic')} title="Italic"><Italic size={14} /></button>
        <button type="button" className="tb" onMouseDown={keep} onClick={inlineCode} title="Code"><Code size={14} /></button>
        <button type="button" className="tb" onMouseDown={keep} onClick={() => exec('insertUnorderedList')} title="Bulleted list"><List size={14} /></button>
        <button type="button" className="tb" onMouseDown={keep} onClick={openLink} title="Link"><Link2 size={14} /></button>
        {linkOpen && (
          <form className="link-box" onSubmit={applyLink}>
            <input autoFocus placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setLinkOpen(false))} />
            <button className="btn" style={{ height: 26 }}>Add</button>
          </form>
        )}
      </div>
      <div ref={ref} className="editor-body" contentEditable suppressContentEditableWarning data-ph="Add a description…"
        onInput={touch} onBlur={commit} />
    </div>
  );
}

export default function TaskModal() {
  const { tasks, openTaskId, setOpenTaskId, updateTask, patchTask, moveTask, deleteTask, active, startTimer, stopTimer, notify } = useStore();
  const task = tasks.find((t) => t._id === openTaskId);
  const [logs, setLogs] = useState([]);
  const [title, setTitle] = useState(task?.title || '');
  const [sub, setSub] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [editId, setEditId] = useState(null);       // time log being edited
  const [draft, setDraft] = useState({ start: '', end: '' });
  const [adding, setAdding] = useState(false);
  const running = !!task && active?.taskId === task._id;
  const now = useNow(running);

  const reloadLogs = () => api.tasks.get(openTaskId).then((f) => setLogs(f.timeLogs || [])).catch(() => {});
  useEffect(() => { setTitle(task?.title || ''); setConfirm(false); setEditId(null); setAdding(false); }, [openTaskId]); // eslint-disable-line
  useEffect(() => { if (openTaskId) reloadLogs(); }, [openTaskId, active?.logId, task?.totalTrackedSeconds]); // eslint-disable-line

  const known = useMemo(() => ({
    cats: [...new Set(tasks.map((t) => t.category).filter(Boolean))],
    disc: [...new Set(tasks.map((t) => t.discipline).filter(Boolean))],
  }), [tasks]);

  if (!task) return null;
  const close = () => setOpenTaskId(null);
  const live = running ? Math.max(0, (now - Date.parse(active.startTime)) / 1000) : 0;
  const dur = (l) => (l.isRunning ? live : l.durationSeconds);
  const total = logs.reduce((a, l) => a + dur(l), 0);
  const done = task.subtasks.filter((s) => s.done).length;
  const tracked = task.totalTrackedSeconds + live;

  const saveTitle = () => { const v = title.trim(); if (!v) setTitle(task.title); else if (v !== task.title) updateTask(task._id, { title: v }); };
  const saveCategory = (v) => {
    v = v.trim();
    if (v === task.category) return;
    const sib = tasks.find((t) => t.category === v && t.discipline);
    updateTask(task._id, { category: v, ...(!task.discipline && sib ? { discipline: sib.discipline } : {}) });
  };
  const setSubs = (subtasks) => updateTask(task._id, { subtasks });
  const addSub = (e) => {
    if (e.key !== 'Enter' || !sub.trim()) return;
    setSubs([...task.subtasks, { title: sub.trim(), done: false }]); setSub('');
  };

  // ---- time log editing ----
  const startEdit = (l) => { setAdding(false); setEditId(l._id); setDraft({ start: toLocalInput(l.startTime), end: toLocalInput(l.endTime) }); };
  const startAdd = () => {
    setEditId(null); setAdding(true);
    const end = new Date(); const start = new Date(end.getTime() - 30 * 60000);
    setDraft({ start: toLocalInput(start), end: toLocalInput(end) });
  };
  const saveLog = async () => {
    try {
      const body = { startTime: fromLocalInput(draft.start), endTime: fromLocalInput(draft.end) };
      const r = adding ? await api.timelogs.create({ taskId: task._id, ...body }) : await api.timelogs.update({ id: editId, ...body });
      patchTask(task._id, { totalTrackedSeconds: r.totalTrackedSeconds });
      setEditId(null); setAdding(false); reloadLogs();
    } catch (e) { notify(e.message); }
  };
  const removeLog = async (l) => {
    try {
      const r = await api.timelogs.delete(l._id);
      patchTask(task._id, { totalTrackedSeconds: r.totalTrackedSeconds });
      reloadLogs();
    } catch (e) { notify(e.message); }
  };
  const editor = (
    <div className="log-edit">
      <input type="datetime-local" step="1" className="field" value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} />
      <span>→</span>
      <input type="datetime-local" step="1" className="field" value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} />
      <button className="tb" title="Save" onClick={saveLog}><Check size={15} /></button>
      <button className="tb" title="Cancel" onClick={() => { setEditId(null); setAdding(false); }}><X size={15} /></button>
    </div>
  );

  return (
    <Modal onClose={close}>
      <div className="modal-head">
        <span>{task.key}</span><span>/</span>
        <input className="chip-input" style={tagStyle(task.category)} defaultValue={task.category} key={task.category}
          size={Math.max(8, (task.category || '').length + 1)} list="m-cats" placeholder="No category"
          onBlur={(e) => saveCategory(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
        <datalist id="m-cats">{known.cats.map((c) => <option key={c} value={c} />)}</datalist>
        <span className={`pri-label ${task.priority}`}><PriorityIcon priority={task.priority} />{PRIORITIES.find((p) => p.id === task.priority)?.label}</span>
        <span className="sp" />
        {confirm ? (
          <>
            <span style={{ color: 'var(--red)' }}>Delete this task?</span>
            <button className="btn danger" style={{ height: 26 }} onClick={() => deleteTask(task._id)}>Delete</button>
            <button className="btn" style={{ height: 26 }} onClick={() => setConfirm(false)}>Cancel</button>
          </>
        ) : <button className="tb" onClick={() => setConfirm(true)} title="Delete"><Trash2 size={15} /></button>}
        <button className="tb" onClick={close} title="Close"><X size={16} /></button>
      </div>

      <div className="modal-body">
        <div className="modal-main">
          <input className="modal-title" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={saveTitle}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
          <RichEditor key={task._id} html={task.description} onCommit={(h) => updateTask(task._id, { description: h })} />

          <div className="section-head">Sub-tasks <span>{done}/{task.subtasks.length}</span>
            <div className="progress"><i style={{ width: task.subtasks.length ? `${(done / task.subtasks.length) * 100}%` : 0 }} /></div></div>
          {task.subtasks.map((s, i) => (
            <div key={s._id || i} className={`sub ${s.done ? 'done' : ''}`}>
              <button className={`box ${s.done ? 'on' : ''}`} onClick={() => setSubs(task.subtasks.map((x, j) => (j === i ? { ...x, done: !x.done } : x)))}>{s.done && '✓'}</button>
              <span>{s.title}</span>
              <button className="rm" onClick={() => setSubs(task.subtasks.filter((_, j) => j !== i))}><X size={14} /></button>
            </div>
          ))}
          <div className="add-row"><Plus size={16} />
            <input placeholder="Add sub-task and press Enter" value={sub} onChange={(e) => setSub(e.target.value)} onKeyDown={addSub} /></div>

          <div className="section-head">Time logs
            <button className="mini-btn" style={{ marginLeft: 'auto' }} onClick={startAdd}><Plus size={12} />Add time</button></div>
          <div className="logs">
            <div className="row head"><span>#</span><span>Start Time</span><span>End Time</span><span className="r">Duration</span><span /></div>
            {logs.length === 0 && !adding && <div className="none">No time tracked yet.</div>}
            {logs.map((l, i) => (editId === l._id ? <div key={l._id} className="row edit">{editor}</div> : (
              <div className="row" key={l._id}>
                <span>{String(i + 1).padStart(2, '0')}</span>
                <span className="strong">{fmtDateTime(l.startTime)}{l.manual && <em className="manual" title="Added or edited by hand"> ✎</em>}</span>
                <span className={l.isRunning ? 'run' : ''}>{l.isRunning ? '● running' : fmtDateTime(l.endTime)}</span>
                <span className="r strong">{hms(dur(l))}</span>
                <span className="acts">
                  {!l.isRunning && <>
                    <button className="tb sm" title="Edit" onClick={() => startEdit(l)}><Pencil size={12} /></button>
                    <button className="tb sm" title="Delete" onClick={() => removeLog(l)}><Trash2 size={12} /></button>
                  </>}
                </span>
              </div>
            )))}
            {adding && <div className="row edit">{editor}</div>}
            {logs.length > 0 && <div className="row total"><span>Total</span><span /><span /><span className="r">{hms(total)}</span><span /></div>}
          </div>
        </div>

        <aside className="modal-side">
          <div className="label">Status</div>
          <Select value={task.status} options={STATUSES} onChange={(s) => moveTask(task._id, s)} />
          {task.status === 'blocked' && (
            <input className="field" style={{ marginTop: 8 }} placeholder="Why is it blocked?" defaultValue={task.blockedReason} key={`${task._id}-r`}
              autoFocus={!task.blockedReason}
              onBlur={(e) => e.target.value.trim() !== task.blockedReason && updateTask(task._id, { blockedReason: e.target.value.trim() })}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
          )}
          <div className="label">Priority</div>
          <Select value={task.priority} options={PRIORITIES} onChange={(p) => updateTask(task._id, { priority: p })} />
          <div className="label">Due date</div>
          <div className="date-row">
            <input className="field" type="date" value={task.dueDate || ''} onChange={(e) => updateTask(task._id, { dueDate: e.target.value || null })} />
            {task.dueDate && <button className="tb" title="Clear" onClick={() => updateTask(task._id, { dueDate: null })}><X size={14} /></button>}
          </div>
          <div className="label">Repeat</div>
          <Select value={task.repeat || 'none'} options={REPEATS} onChange={(r) => updateTask(task._id, { repeat: r })} />
          <div className="label">Estimate (minutes)</div>
          <input className="field" type="number" min="0" step="5" defaultValue={task.estimateMinutes || ''} key={`${task._id}-e`} placeholder="e.g. 90"
            onBlur={(e) => Number(e.target.value || 0) !== task.estimateMinutes && updateTask(task._id, { estimateMinutes: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
          <div className="label">Discipline</div>
          <input className="field" list="m-disc" defaultValue={task.discipline} key={task.discipline} placeholder="e.g. Full-Stack Dev"
            onBlur={(e) => e.target.value.trim() !== task.discipline && updateTask(task._id, { discipline: e.target.value.trim() })}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
          <datalist id="m-disc">{known.disc.map((c) => <option key={c} value={c} />)}</datalist>
          <div className="label">Tracked</div>
          <div className={`tracked ${task.estimateMinutes > 0 && tracked > task.estimateMinutes * 60 ? 'over' : ''}`}>{hms(tracked)}</div>
          {task.estimateMinutes > 0 && <div className="meta" style={{ marginBottom: 10 }}>of {hms(task.estimateMinutes * 60)} estimated</div>}
          {running
            ? <button className="btn outline block" onClick={() => stopTimer()}><Pause size={14} />Pause timer</button>
            : <button className="btn primary block" onClick={() => startTimer(task._id)}><Play size={14} />Start timer</button>}
        </aside>
      </div>
    </Modal>
  );
}
