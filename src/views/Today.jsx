import { useEffect, useState } from 'react';
import { Calendar, Pause, Play, Plus, Sparkles } from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.jsx';
import { useNow } from '../hooks.js';
import { dueInfo, hms, tagStyle, todayStr, ymd } from '../lib.js';
import { PriorityIcon, Topbar } from '../components/ui.jsx';

function Row({ t, action, active, startTimer, stopTimer, setOpenTaskId }) {
  const running = active?.taskId === t._id;
  const due = dueInfo(t.dueDate);
  return (
    <div className="trow" onClick={() => setOpenTaskId(t._id)}>
      <PriorityIcon priority={t.priority} />
      <span className="key">{t.key}</span>
      <span className="ttl">{t.title}</span>
      {t.category && <span className="tag" style={tagStyle(t.category)}>{t.category}</span>}
      {t.estimateMinutes > 0 && <span className="meta">{Math.round((t.estimateMinutes / 60) * 10) / 10}h est</span>}
      {due && <span className={`meta ${due.cls}`}><Calendar size={11} />{due.label}</span>}
      {action}
      <button className={`play ${running ? 'on' : ''}`} onClick={(e) => { e.stopPropagation(); if (running) stopTimer(); else startTimer(t._id); }}>
        {running ? <Pause size={12} /> : <Play size={12} />}
      </button>
    </div>
  );
}

function Section({ title, list, tone, action, rowProps }) {
  if (!list.length) return null;
  return (
    <section className="goal-sec">
      <h2 style={tone ? { color: tone } : null}>{title}<span>{list.length}</span></h2>
      <div className="tlist">{list.map((t) => <Row key={t._id} t={t} action={action?.(t)} {...rowProps} />)}</div>
    </section>
  );
}

export default function Today() {
  const { tasks, active, startTimer, stopTimer, setOpenTaskId, updateTask, notify } = useStore();
  const [plan, setPlan] = useState(null);
  const [aiPlan, setAiPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const now = useNow(!!active);
  const today = todayStr();

  useEffect(() => { api.analytics.summary().then((r) => setPlan({ ...r, at: Date.now() })).catch((e) => notify(e.message)); }, [active?.logId]); // eslint-disable-line

  const open = tasks.filter((t) => t.status !== 'completed');
  const overdue = open.filter((t) => t.dueDate && t.dueDate < today).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const dueToday = open.filter((t) => t.dueDate === today);
  const doing = open.filter((t) => t.status === 'in_progress' && (!t.dueDate || t.dueDate > today));
  const suggestions = open.filter((t) => t.status === 'up_next' && !t.dueDate).slice(0, 5);
  const doneToday = tasks.filter((t) => t.completedAt && ymd(new Date(t.completedAt)) === today).length;

  const dayIdx = (new Date().getDay() + 6) % 7;
  const capacity = plan?.planned?.[dayIdx] ?? 0;
  const liveSecs = active && plan ? Math.max(0, (now - Math.max(plan.at, Date.parse(active.startTime))) / 1000) : 0;
  const trackedToday = (plan?.actual?.[dayIdx] ?? 0) + liveSecs / 3600;
  const planned = [...overdue, ...dueToday, ...doing].reduce((a, t) => a + (t.estimateMinutes || 0), 0) / 60;
  const unestimated = [...overdue, ...dueToday, ...doing].filter((t) => !t.estimateMinutes).length;
  const free = capacity - planned;
  const rowProps = { active, startTimer, stopTimer, setOpenTaskId };

  const generatePlan = async () => {
    setBusy(true);
    try { setAiPlan(await api.ai.planDay({ capacityHours: capacity })); }
    catch (e) { notify(e.message); } finally { setBusy(false); }
  };

  const applyAiPlan = async () => {
    if (!aiPlan?.orderedTasks) return;
    for (const item of aiPlan.orderedTasks) {
      if (item.action === 'do_today') {
        await updateTask(item.id, { dueDate: today, ...(item.suggestedMinutes ? { estimateMinutes: item.suggestedMinutes } : {}) });
      } else if (item.action === 'defer') {
        await updateTask(item.id, { dueDate: null });
      }
    }
    notify('Applied AI day plan');
    setAiPlan(null);
  };

  return (
    <>
      <Topbar title="Today" meta={new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}>
        <button className="ai-btn" disabled={busy} onClick={generatePlan}>
          <Sparkles size={13} />{busy ? 'Planning day…' : 'Plan my day'}
        </button>
      </Topbar>
      <div className="view"><div className="page">
        <div className="stats">
          <div className="stat"><div className="k">CAPACITY TODAY</div><div className="v">{capacity.toFixed(1)}h</div></div>
          <div className="stat"><div className="k">PLANNED (EST.)</div><div className="v">{planned.toFixed(1)}h</div>
            {unestimated > 0 && <div className="meta" style={{ marginTop: 6 }}>{unestimated} task{unestimated > 1 ? 's' : ''} without estimate</div>}</div>
          <div className="stat"><div className="k">TRACKED</div><div className="v">{hms(trackedToday * 3600)}</div></div>
          <div className="stat"><div className="k">{free >= 0 ? 'FREE CAPACITY' : 'OVER-PLANNED'}</div>
            <div className="v" style={{ color: free < 0 ? 'var(--red)' : undefined }}>{Math.abs(free).toFixed(1)}h</div>
            <div className="meta" style={{ marginTop: 6 }}>{doneToday} completed today</div></div>
        </div>

        {aiPlan && (
          <div className="ai-box">
            <h4>
              <Sparkles size={14} /> Proposed Day Plan ({aiPlan.totalPlannedHours}h total)
              {aiPlan.overPlanned && <span className="meta overdue" style={{ marginLeft: 8 }}>Over-planned vs {capacity}h capacity</span>}
            </h4>
            <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{aiPlan.summary}</div>
            <div className="tlist">
              {aiPlan.orderedTasks.map((it, idx) => (
                <div key={it.id} className="trow" onClick={() => setOpenTaskId(it.id)}>
                  <span className="mono meta">#{idx + 1}</span>
                  <span className="key">{it.key}</span>
                  <span className="ttl">{it.title}</span>
                  <span className="meta">{it.suggestedMinutes}m</span>
                  <span className={`tag`} style={tagStyle(it.action === 'do_today' ? 'Today' : 'Defer')}>{it.action === 'do_today' ? 'Do Today' : 'Defer'}</span>
                  <span className="meta">{it.reason}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn primary" onClick={applyAiPlan}>Apply schedule &amp; estimates</button>
              <button className="btn" onClick={() => setAiPlan(null)}>Dismiss</button>
            </div>
          </div>
        )}

        <Section title="Overdue" list={overdue} tone="var(--red)" rowProps={rowProps} />
        <Section title="Due today" list={dueToday} rowProps={rowProps} />
        <Section title="In progress" list={doing} rowProps={rowProps} />
        {overdue.length + dueToday.length + doing.length === 0 && (
          <div className="empty-page">Nothing planned for today. Add something from Up Next below, or give a task a due date.</div>
        )}
        <Section title="Suggested from Up Next" list={suggestions} rowProps={rowProps}
          action={(t) => <button className="mini-btn" onClick={(e) => { e.stopPropagation(); updateTask(t._id, { dueDate: today }); }}><Plus size={12} />Add to today</button>} />
      </div></div>
    </>
  );
}
