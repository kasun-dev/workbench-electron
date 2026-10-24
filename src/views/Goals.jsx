import { useState } from 'react';
import { ArrowUpRight, Calendar, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.jsx';
import { GOAL_STATUSES, PRIORITIES, hm, tagStyle } from '../lib.js';
import { Modal, PriorityIcon, Select, Topbar } from '../components/ui.jsx';

const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const progress = (g) => (g.milestones.length ? g.milestones.filter((m) => m.done).length / g.milestones.length : 0);

function GoalCard({ g }) {
  const { setOpenGoalId, promoteGoal } = useStore();
  const canPromote = !['achieved', 'archived'].includes(g.status);
  return (
    <div className="goal" onClick={() => setOpenGoalId(g._id)}>
      <div className="row"><PriorityIcon priority={g.priority} /><h3>{g.title}</h3></div>
      {g.description && <p>{g.description.replace(/<[^>]+>/g, '')}</p>}
      {g.milestones.length > 0 && (
        <div className="row"><div className="progress"><i style={{ width: `${progress(g) * 100}%` }} /></div>
          <span className="meta">{g.milestones.filter((m) => m.done).length}/{g.milestones.length}</span></div>
      )}
      <div className="row">
        {g.category && <span className="tag" style={tagStyle(g.category)}>{g.category}</span>}
        {g.targetDate && <span className="meta"><Calendar size={11} />{fmtDate(g.targetDate)}</span>}
        {g.tasksTotal > 0 && <span className="meta" title="Tasks promoted from this goal">{g.tasksDone}/{g.tasksTotal} tasks · {hm(g.trackedSeconds || 0)}</span>}
        <span className="sp" />
        {canPromote && <button className="mini-btn" onClick={(e) => { e.stopPropagation(); promoteGoal(g._id); }}>Promote <ArrowUpRight size={13} /></button>}
      </div>
    </div>
  );
}

export function Goals() {
  const { goals, createGoal } = useStore();
  const [title, setTitle] = useState('');
  const add = async (e) => {
    if (e.key !== 'Enter' || !title.trim()) return;
    await createGoal({ title: title.trim() }); setTitle('');
  };
  return (
    <>
      <Topbar title="Long-Term Goals" meta={`${goals.length} goals`} />
      <div className="view"><div className="page">
        <div className="goal-add"><Plus size={16} />
          <input placeholder="Add a someday goal and press Enter" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={add} /></div>
        {goals.length === 0 && <div className="empty-page">Nothing here yet. Park big ideas here and promote them to the board when you're ready.</div>}
        {GOAL_STATUSES.map((s) => {
          const list = goals.filter((g) => g.status === s.id);
          if (!list.length) return null;
          return (
            <section className="goal-sec" key={s.id}>
              <h2>{s.label}<span>{list.length}</span></h2>
              <div className="goal-grid">{list.map((g) => <GoalCard key={g._id} g={g} />)}</div>
            </section>
          );
        })}
      </div></div>
    </>
  );
}

export function GoalModal() {
  const { goals, openGoalId, setOpenGoalId, updateGoal, deleteGoal, promoteGoal, createTask, createGoal, notify } = useStore();
  const g = goals.find((x) => x._id === openGoalId);
  const [title, setTitle] = useState(g?.title || '');
  const [desc, setDesc] = useState(g?.description || '');
  const [ms, setMs] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState('');
  const [coach, setCoach] = useState(null);

  if (!g) return null;
  const close = () => setOpenGoalId(null);
  const canPromote = !['achieved', 'archived'].includes(g.status);
  const setMilestones = (milestones) => updateGoal(g._id, { milestones });
  const done = g.milestones.filter((m) => m.done).length;
  const blurSave = (key, val) => val !== g[key] && updateGoal(g._id, { [key]: val });

  const aiBreakdown = async () => {
    setBusy('ms');
    try {
      const r = await api.ai.breakdown({ kind: 'goal', title: g.title, description: g.description, existing: g.milestones.map((m) => m.title) });
      if (r.items?.length) setMilestones([...g.milestones, ...r.items.map((t) => ({ title: t, done: false }))]);
    } catch (e) { notify(e.message); } finally { setBusy(''); }
  };

  const aiCoach = async () => {
    setBusy('coach');
    try {
      setCoach(await api.ai.coachGoal(g._id));
    } catch (e) { notify(e.message); } finally { setBusy(''); }
  };

  const promoteFirstTask = async () => {
    if (!coach?.firstTask) return;
    const ft = coach.firstTask;
    const t = await createTask({
      title: ft.title, category: g.category, discipline: g.discipline,
      priority: ft.priority || g.priority, estimateMinutes: ft.estimateMinutes || 60,
      status: 'up_next', subtasks: (ft.subtasks || []).map((s) => ({ title: s, done: false })),
    });
    if (t) {
      await updateGoal(g._id, { status: 'in_motion' });
      notify(`Created first step task: ${t.key}`);
      close();
    }
  };

  const applySplit = async () => {
    if (!coach?.splitGoals?.length) return;
    for (const st of coach.splitGoals) {
      await createGoal({ title: st, category: g.category, discipline: g.discipline, priority: g.priority });
    }
    await updateGoal(g._id, { status: 'archived' });
    notify(`Split into ${coach.splitGoals.length} focused goals`);
    close();
  };

  return (
    <Modal onClose={close}>
      <div className="modal-head">
        <span>GOAL</span><span>/</span>
        <span className="pri-label"><PriorityIcon priority={g.priority} />{PRIORITIES.find((p) => p.id === g.priority)?.label}</span>
        <button className="ai-btn" disabled={busy === 'coach'} onClick={aiCoach}><Sparkles size={12} />{busy === 'coach' ? 'Coaching…' : 'Goal Coach'}</button>
        <span className="sp" />
        {confirm ? (
          <>
            <span style={{ color: 'var(--red)' }}>Delete this goal?</span>
            <button className="btn danger" style={{ height: 26 }} onClick={() => deleteGoal(g._id)}>Delete</button>
            <button className="btn" style={{ height: 26 }} onClick={() => setConfirm(false)}>Cancel</button>
          </>
        ) : <button className="tb" onClick={() => setConfirm(true)}><Trash2 size={15} /></button>}
        <button className="tb" onClick={close}><X size={16} /></button>
      </div>
      <div className="modal-body">
        <div className="modal-main">
          <input className="modal-title" value={title} onChange={(e) => setTitle(e.target.value)}
            onBlur={() => (title.trim() ? blurSave('title', title.trim()) : setTitle(g.title))} />
          <textarea className="field" placeholder="Why does this matter? What does done look like?" value={desc}
            onChange={(e) => setDesc(e.target.value)} onBlur={() => blurSave('description', desc)} />

          {coach && (
            <div className="ai-box" style={{ marginTop: 14 }}>
              <h4><Sparkles size={14} /> AI Coach Recommendation: {coach.recommendation.toUpperCase()}</h4>
              <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{coach.rationale}</div>
              {coach.firstTask && (
                <div className="ai-sec">
                  <b>Suggested First Concrete Task ({coach.firstTask.estimateMinutes}m)</b>
                  <div>{coach.firstTask.title}</div>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn primary" onClick={promoteFirstTask}>Promote first step task</button>
                {coach.splitGoals?.length > 0 && <button className="btn" onClick={applySplit}>Split into {coach.splitGoals.length} goals</button>}
                {coach.recommendation === 'drop' && <button className="btn danger" onClick={() => { updateGoal(g._id, { status: 'archived' }); close(); }}>Archive goal</button>}
              </div>
            </div>
          )}

          <div className="section-head">Milestones <span>{done}/{g.milestones.length}</span>
            <div className="progress"><i style={{ width: `${progress(g) * 100}%` }} /></div>
            <button className="ai-btn" disabled={busy === 'ms'} onClick={aiBreakdown}><Sparkles size={12} />{busy === 'ms' ? 'Generating…' : 'Breakdown'}</button>
          </div>
          {g.milestones.map((m, i) => (
            <div key={m._id || i} className={`sub ${m.done ? 'done' : ''}`}>
              <button className={`box ${m.done ? 'on' : ''}`} onClick={() => setMilestones(g.milestones.map((x, j) => (j === i ? { ...x, done: !x.done } : x)))}>{m.done && '✓'}</button>
              <span>{m.title}</span>
              <button className="rm" onClick={() => setMilestones(g.milestones.filter((_, j) => j !== i))}><X size={14} /></button>
            </div>
          ))}
          <div className="add-row"><Plus size={16} />
            <input placeholder="Add milestone and press Enter" value={ms} onChange={(e) => setMs(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && ms.trim()) { setMilestones([...g.milestones, { title: ms.trim(), done: false }]); setMs(''); } }} /></div>
        </div>
        <aside className="modal-side">
          <div className="label">Status</div>
          <Select value={g.status} options={GOAL_STATUSES} onChange={(s) => updateGoal(g._id, { status: s })} />
          <div className="label">Priority</div>
          <Select value={g.priority} options={PRIORITIES} onChange={(p) => updateGoal(g._id, { priority: p })} />
          <div className="label">Category</div>
          <input className="field" defaultValue={g.category} onBlur={(e) => blurSave('category', e.target.value.trim())} />
          <div className="label">Discipline</div>
          <input className="field" defaultValue={g.discipline} onBlur={(e) => blurSave('discipline', e.target.value.trim())} />
          <div className="label">Target date</div>
          <input className="field" type="date" defaultValue={g.targetDate ? g.targetDate.slice(0, 10) : ''}
            onChange={(e) => updateGoal(g._id, { targetDate: e.target.value || null })} />
          <div style={{ height: 14 }} />
          {canPromote && <button className="btn primary block" onClick={async () => { const t = await promoteGoal(g._id); if (t) close(); }}>
            <ArrowUpRight size={15} />Promote to board</button>}
          {g.tasksTotal > 0 && <div className="meta" style={{ marginTop: 10, lineHeight: 1.6 }}>Promoted {g.promotedTasks.length}×<br />{g.tasksDone}/{g.tasksTotal} tasks done<br />{hm(g.trackedSeconds || 0)} tracked</div>}
        </aside>
      </div>
    </Modal>
  );
}
