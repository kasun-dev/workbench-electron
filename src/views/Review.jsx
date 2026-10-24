import { useEffect, useState } from 'react';
import { ArrowUpRight, Sparkles } from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.jsx';
import { Topbar } from '../components/ui.jsx';
import { shortDate, tagStyle } from '../lib.js';

export default function Review() {
  const { setView, setOpenTaskId, setOpenGoalId, promoteGoal, notify } = useStore();
  const [d, setD] = useState(null);
  const [narrative, setNarrative] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.review.summary().then(setD).catch((e) => notify(e.message));
  useEffect(() => { load(); }, []); // eslint-disable-line

  if (!d) return <Topbar title="Weekly Review" />;
  const delta = Math.round((d.totalHours - d.prevHours) * 10) / 10;
  const maxH = Math.max(1, ...d.byCategory.map((c) => c.hours));

  const genNarrative = async () => {
    setBusy(true);
    try { setNarrative(await api.ai.weeklyNarrative(d)); }
    catch (e) { notify(e.message); } finally { setBusy(false); }
  };

  return (
    <>
      <Topbar title="Weekly Review" meta="last 7 days">
        <button className="ai-btn" disabled={busy} onClick={genNarrative}>
          <Sparkles size={13} />{busy ? 'Writing recap…' : 'AI Weekly Narrative'}
        </button>
      </Topbar>
      <div className="view"><div className="page">
        {narrative && (
          <div className="ai-box">
            <h4><Sparkles size={14} /> {narrative.headline}</h4>
            <div className="ai-grid">
              <div className="ai-sec"><b>What Shipped</b>{narrative.shippedRecap}</div>
              <div className="ai-sec"><b>Accuracy &amp; Pacing</b>{narrative.accuracyAnalysis}</div>
              <div className="ai-sec"><b>Next Week Focus</b>{narrative.nextWeekFocus}</div>
            </div>
          </div>
        )}

        <div className="stats">
          <div className="stat"><div className="k">HOURS TRACKED</div><div className="v">{d.totalHours.toFixed(1)}h</div>
            <div className="meta" style={{ marginTop: 6, color: delta >= 0 ? 'var(--accent)' : 'var(--amber)' }}>{delta >= 0 ? '+' : ''}{delta}h vs previous 7 days</div></div>
          <div className="stat"><div className="k">TASKS COMPLETED</div><div className="v">{d.completed.length}</div></div>
          <div className="stat"><div className="k">SESSIONS</div><div className="v">{d.sessions}</div></div>
          <div className="stat"><div className="k">PLAN ACCURACY</div><div className="v">{d.accuracy}%</div>
            <div className="meta" style={{ marginTop: 6 }}>of {d.plannedWeek}h weekly plan</div></div>
        </div>

        <div className="charts even">
          <div className="panel">
            <h3>Completed</h3><div className="sub-t">What you shipped this week</div>
            <div className="tlist" style={{ marginTop: 12 }}>
              {d.completed.length === 0 && <div className="empty">Nothing completed yet.</div>}
              {d.completed.map((t) => (
                <div className="trow" key={t._id} onClick={() => setOpenTaskId(t._id)}>
                  <span className="key">{t.key}</span><span className="ttl">{t.title}</span>
                  {t.category && <span className="tag" style={tagStyle(t.category)}>{t.category}</span>}
                  <span className="meta">{shortDate(t.completedAt.slice(0, 10))}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="panel">
            <h3>Where the time went</h3><div className="sub-t">By category</div>
            <div style={{ marginTop: 14 }}>
              {d.byCategory.length === 0 && <div className="empty">No time tracked this week.</div>}
              {d.byCategory.map((c) => (
                <div className="bar-row" key={c.name}>
                  <span className="tag" style={tagStyle(c.name)}>{c.name}</span>
                  <div className="hbar"><i style={{ width: `${(c.hours / maxH) * 100}%` }} /></div>
                  <span className="meta">{c.hours.toFixed(1)}h</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="charts even">
          <div className="panel">
            <h3>Needs attention</h3><div className="sub-t">Blocked and overdue work (click any blocked task for AI unblock steps)</div>
            <div className="tlist" style={{ marginTop: 12 }}>
              {d.blocked.length + d.overdue.length === 0 && <div className="empty">All clear. Nothing blocked or overdue.</div>}
              {d.blocked.map((t) => (
                <div className="trow" key={t._id} onClick={() => setOpenTaskId(t._id)}>
                  <span className="sdot blocked" /><span className="key">{t.key}</span><span className="ttl">{t.title}</span>
                  {t.blockedReason && <span className="meta" style={{ color: 'var(--red)' }}>{t.blockedReason}</span>}
                  <span className="ai-btn" style={{ height: 22 }}><Sparkles size={11} />Unblock</span>
                </div>
              ))}
              {d.overdue.map((t) => (
                <div className="trow" key={t._id} onClick={() => setOpenTaskId(t._id)}>
                  <span className="key">{t.key}</span><span className="ttl">{t.title}</span>
                  <span className="meta overdue">due {shortDate(t.dueDate)}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="panel">
            <h3>Someday goals gathering dust</h3><div className="sub-t">Older than 30 days and never promoted</div>
            <div className="tlist" style={{ marginTop: 12 }}>
              {d.staleGoals.length === 0 && <div className="empty">Nothing stale. Nice.</div>}
              {d.staleGoals.map((g) => (
                <div className="trow" key={g._id} onClick={() => setOpenGoalId(g._id)}>
                  <span className="ttl">{g.title}</span>
                  {g.category && <span className="tag" style={tagStyle(g.category)}>{g.category}</span>}
                  <span className="ai-btn" style={{ height: 22 }}><Sparkles size={11} />Coach</span>
                  <button className="mini-btn" onClick={async (e) => { e.stopPropagation(); await promoteGoal(g._id); load(); }}>Promote <ArrowUpRight size={12} /></button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="panel" style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <h3>Plan next week</h3>
            <div className="sub-t">Your weekly plan is {d.plannedWeek}h. Adjust it in Settings, and give tasks due dates to see them on Today.</div>
          </div>
          <button className="btn" onClick={() => setView('settings')}>Edit weekly plan</button>
          <button className="btn primary" onClick={() => setView('today')}>Go to Today</button>
        </div>
      </div></div>
    </>
  );
}
