import { useEffect, useMemo, useState } from 'react';
import { Check, Download, Printer, Sparkles } from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.jsx';
import { Modal, Topbar } from '../components/ui.jsx';
import { money, tagStyle, todayStr } from '../lib.js';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const COLORS = ['var(--accent)', 'var(--blue)', 'var(--pink)', 'var(--amber)', 'var(--purple)', 'var(--muted)'];
const h1 = (n) => `${(n ?? 0).toFixed(1)}h`;

function Donut({ data, onTip, clearTip }) {
  const [hov, setHov] = useState(null);
  const R = 72, C = 2 * Math.PI * R;
  const total = data.allocation.reduce((a, b) => a + b.hours, 0);
  let off = 0;
  const segs = data.allocation.map((a, i) => {
    const len = total ? (a.hours / total) * C : 0;
    const gap = data.allocation.length > 1 ? 3 : 0;
    const s = { ...a, color: COLORS[i % COLORS.length], dash: `${Math.max(0, len - gap)} ${C}`, offset: -off };
    off += len;
    return s;
  });
  const activeSeg = hov != null ? segs[hov] : null;

  return (
    <>
      <div className="donut">
        <svg viewBox="0 0 200 200">
          <g transform="rotate(-90 100 100)">
            <circle cx="100" cy="100" r={R} fill="none" stroke="var(--border)" strokeWidth="18" />
            {segs.map((s, i) => (
              <circle
                key={s.name}
                cx="100"
                cy="100"
                r={R}
                fill="none"
                stroke={s.color}
                strokeWidth={hov === i ? '22' : '18'}
                className={hov != null && hov !== i ? 'dim' : ''}
                strokeDasharray={s.dash}
                strokeDashoffset={s.offset}
                onMouseMove={(e) => {
                  setHov(i);
                  onTip(e, s.name, `${h1(s.hours)} (${s.pct}% of week)`);
                }}
                onMouseLeave={() => { setHov(null); clearTip(); }}
              />
            ))}
          </g>
        </svg>
        <div className="mid">
          <b>{activeSeg ? h1(activeSeg.hours) : h1(data.allocationTotal)}</b>
          <span>{activeSeg ? `${activeSeg.name.toUpperCase()} (${activeSeg.pct}%)` : 'TRACKED'}</span>
        </div>
      </div>
      {segs.length === 0 && <div className="empty">Track some time to see your split</div>}
      {segs.map((s, i) => (
        <div
          className="lg"
          key={s.name}
          style={{ cursor: 'pointer', opacity: hov != null && hov !== i ? 0.5 : 1 }}
          onMouseMove={(e) => { setHov(i); onTip(e, s.name, `${h1(s.hours)} tracked · ${s.pct}%`); }}
          onMouseLeave={() => { setHov(null); clearTip(); }}
        >
          <span><i style={{ background: s.color }} />{s.name}</span>
          <span className="h">{h1(s.hours)}</span>
          <span className="p">{s.pct}%</span>
        </div>
      ))}
    </>
  );
}

function Trend({ data, onTip, clearTip }) {
  const [hov, setHov] = useState(null);
  const W = 420, H = 130, P = 16;
  const max = Math.max(1, ...data.map((d) => d.hours));
  const pts = data.map((d, i) => [P + (i * (W - P * 2)) / Math.max(1, data.length - 1), H - P - (d.hours / max) * (H - P * 2)]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const colW = (W - P * 2) / Math.max(1, data.length - 1);

  return (
    <svg viewBox={`0 0 ${W} ${H + 18}`} className="trend" onMouseLeave={() => { setHov(null); clearTip(); }}>
      <path d={`${line} L${pts[pts.length - 1][0]},${H - P} L${pts[0][0]},${H - P} Z`} fill="var(--accent)" opacity="0.12" />
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />
      {hov != null && (
        <line x1={pts[hov][0]} y1={P / 2} x2={pts[hov][0]} y2={H - P} stroke="var(--border2)" strokeDasharray="3 3" strokeWidth="1" />
      )}
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={p[0]} cy={p[1]} r={hov === i ? '5' : '2.8'} fill="var(--accent)" />
          <rect
            x={p[0] - colW / 2}
            y={0}
            width={colW}
            height={H}
            fill="transparent"
            style={{ cursor: 'pointer' }}
            onMouseMove={(e) => {
              setHov(i);
              const prev = i > 0 ? data[i - 1].hours : null;
              const diff = prev != null ? Math.round((data[i].hours - prev) * 10) / 10 : null;
              const deltaStr = diff != null ? ` (${diff >= 0 ? '+' : ''}${diff}h vs prev week)` : '';
              onTip(e, `Week of ${data[i].label}`, `${h1(data[i].hours)} tracked${deltaStr}`);
            }}
          />
        </g>
      ))}
      {data.map((d, i) => (i % 2 === 0 || i === data.length - 1) && (
        <text key={i} x={pts[i][0]} y={H + 10} textAnchor="middle" fontSize="9" fill={hov === i ? 'var(--text)' : 'var(--muted)'} fontFamily="var(--mono)">
          {d.label}
        </text>
      ))}
    </svg>
  );
}

function Heatmap({ days, onTip, clearTip }) {
  const first = new Date(`${days[0].d}T12:00:00`);
  const pad = (first.getDay() + 6) % 7;
  const lvl = (h) => (h <= 0 ? 0 : h < 1 ? 1 : h < 3 ? 2 : h < 5 ? 3 : 4);
  const fmt = (s) => new Date(`${s}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  return (
    <div className="heat-wrap" onMouseLeave={clearTip}>
      <div className="heat">
        {Array.from({ length: pad }, (_, i) => <i key={`p${i}`} className="hc blank" />)}
        {days.map((d) => (
          <i
            key={d.d}
            className={`hc l${lvl(d.h)}`}
            onMouseMove={(e) => onTip(e, fmt(d.d), d.h > 0 ? `${h1(d.h)} tracked` : 'No time tracked')}
          />
        ))}
      </div>
    </div>
  );
}

function ExportDialog({ onClose }) {
  const { user, tasks, notify } = useStore();
  const cur = user?.preferences?.currency || 'LKR';
  const t = todayStr();
  const [from, setFrom] = useState(`${t.slice(0, 8)}01`);
  const [to, setTo] = useState(t);
  const [category, setCategory] = useState('');
  const [hourlyRate, setHourlyRate] = useState('');
  const [aiSummary, setAiSummary] = useState(true);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  const cats = useMemo(() => [...new Set(tasks.map((x) => x.category).filter(Boolean))], [tasks]);

  const loadPreview = async () => {
    setBusy(true);
    try { setPreview(await api.ai.summarizeTimesheet({ from, to, category })); }
    catch (e) { notify(e.message); } finally { setBusy(false); }
  };

  const go = async () => {
    setBusy(true);
    try {
      const r = await api.data.exportTimesheet({ from, to, aiSummary });
      if (r.saved) { notify(`Exported ${r.count} entries (${r.hours}h)`); onClose(); }
    } catch (e) { notify(e.message); } finally { setBusy(false); }
  };

  const totalHours = preview ? Math.round(preview.reduce((a, b) => a + b.hours, 0) * 100) / 100 : 0;
  const rate = Number(hourlyRate) || 0;

  return (
    <Modal onClose={onClose}>
      <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h3 style={{ fontSize: 16 }}>Export Timesheet &amp; Client Invoice Report</h3>
        <div className="grid2">
          <label className="fl"><span>From</span><input className="field" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="fl"><span>To</span><input className="field" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <label className="fl"><span>Category / Client filter (optional)</span>
            <input className="field" list="exp-cats" placeholder="All categories" value={category} onChange={(e) => setCategory(e.target.value)} />
            <datalist id="exp-cats">{cats.map((c) => <option key={c} value={c} />)}</datalist>
          </label>
          <label className="fl"><span>Hourly rate ({cur}, optional)</span>
            <input className="field mono" type="number" min="0" step="100" placeholder="e.g. 3500" value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value)} />
          </label>
        </div>
        <label className="check-row" style={{ padding: 0 }} onClick={() => setAiSummary(!aiSummary)}>
          <span className={`box ${aiSummary ? 'on' : ''}`}>{aiSummary && '✓'}</span>
          <span><Sparkles size={12} style={{ color: 'var(--purple)', marginRight: 4 }} />Include AI client-friendly session summaries</span>
        </label>
        {preview && (
          <div className="ai-box" style={{ maxHeight: 260, overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h4><Sparkles size={13} /> {category || 'All Work'} — {totalHours}h {rate > 0 ? `· Total: ${money(totalHours * rate, cur)}` : ''}</h4>
              <button className="mini-btn" onClick={() => window.print()}><Printer size={12} />Print / Save PDF</button>
            </div>
            <div className="logs">
              <div className="row head" style={{ gridTemplateColumns: '90px 70px 1fr 70px' }}>
                <span>Date</span><span>Task</span><span>AI Client Summary</span><span className="r">Hours</span>
              </div>
              {preview.map((p, i) => (
                <div key={i} className="row" style={{ gridTemplateColumns: '90px 70px 1fr 70px' }}>
                  <span>{p.date}</span><span className="key">{p.key}</span><span>{p.line}</span><span className="r strong">{p.hours}h</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="ai-btn" style={{ height: 36, padding: '0 14px' }} disabled={busy} onClick={loadPreview}>
            <Sparkles size={13} />{busy ? 'Generating…' : 'Generate AI Invoice Preview'}
          </button>
          <button className="btn primary block" style={{ flex: 1 }} disabled={busy} onClick={go}><Download size={14} />Export CSV</button>
        </div>
      </div>
    </Modal>
  );
}

export default function Analytics() {
  const { active, setUser, notify } = useStore();
  const [d, setD] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [coach, setCoach] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [tip, setTip] = useState(null); // { x, y, title, sub }

  const load = () => api.analytics.summary().then(setD).catch((e) => notify(e.message));
  useEffect(() => { load(); }, [active?.logId]); // eslint-disable-line

  const showTip = (e, title, sub) => setTip({ x: e.clientX, y: e.clientY, title, sub });
  const clearTip = () => setTip(null);

  const runAiCoach = async () => {
    if (!d) return;
    setAiBusy(true);
    try {
      const payload = {
        planned: d.planned,
        actual: d.actual,
        plannedTotal: d.plannedTotal,
        actualTotal: d.actualTotal,
        accuracy: d.accuracy,
        sessions: d.sessions,
        allocation: d.allocation,
        streak: d.streak,
        bestStreak: d.bestStreak,
        trend: d.trend,
        estimate: d.estimate,
      };
      setCoach(await api.ai.analyticsInsights(payload));
    } catch (e) { notify(e.message); } finally { setAiBusy(false); }
  };

  const applySuggestedPlan = async () => {
    if (!coach?.suggestedWeeklyPlan || coach.suggestedWeeklyPlan.length !== 7) return;
    try {
      const updatedUser = await api.user.updatePreferences({ weeklyPlan: coach.suggestedWeeklyPlan });
      setUser(updatedUser);
      await load();
      notify('Weekly capacity plan updated!');
    } catch (e) { notify(e.message); }
  };

  if (!d) return <Topbar title="Analytics" />;
  const max = Math.max(12, Math.ceil(Math.max(...d.planned, ...d.actual) / 4) * 4);
  const ticks = [0, 1, 2, 3, 4].map((i) => max - (max / 4) * i);
  const est = d.estimate;
  const yearTotal = d.heatmap.reduce((a, x) => a + x.h, 0);

  return (
    <>
      <Topbar title="Analytics">
        <button className="ai-btn" disabled={aiBusy} onClick={runAiCoach}>
          <Sparkles size={13} />{aiBusy ? 'Analyzing…' : 'AI Productivity Coach'}
        </button>
        <button className="btn" onClick={() => setExporting(true)}><Download size={14} />Timesheet &amp; Invoice</button>
      </Topbar>

      {tip && (
        <div className="chart-tip" style={{ left: Math.min(tip.x, window.innerWidth - 240), top: tip.y }}>
          <b>{tip.title}</b>
          <span className="muted">{tip.sub}</span>
        </div>
      )}

      <div className="view" onScroll={clearTip}><div className="page">
        {coach && (
          <div className="ai-box">
            <h4>
              <Sparkles size={14} /> {coach.headline}
              <button className="btn" style={{ marginLeft: 'auto', height: 24, padding: '0 8px' }} onClick={() => setCoach(null)}>Dismiss</button>
            </h4>
            <div className="ai-grid">
              <div className="ai-sec"><b>Capacity vs Reality</b>{coach.capacityAnalysis}</div>
              <div className="ai-sec"><b>Discipline Split</b>{coach.allocationInsight}</div>
              <div className="ai-sec"><b>Pacing &amp; Focus Tip</b>{coach.burnoutOrPacingTip}</div>
            </div>
            {coach.suggestedWeeklyPlan?.length === 7 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', paddingTop: 4 }}>
                <span className="meta">
                  Suggested Weekly Plan ({coach.suggestedWeeklyPlan.reduce((a, b) => a + b, 0)}h/wk):{' '}
                  <b className="mono" style={{ color: 'var(--text)' }}>
                    {DAYS.map((day, i) => `${day} ${coach.suggestedWeeklyPlan[i]}h`).join(' · ')}
                  </b>
                </span>
                <button className="btn primary" style={{ marginLeft: 'auto', height: 28 }} onClick={applySuggestedPlan}>
                  <Check size={13} />Apply suggested plan
                </button>
              </div>
            )}
          </div>
        )}

        <div className="stats">
          <div className="stat"><div className="k">PLANNED</div><div className="v">{h1(d.plannedTotal)}</div></div>
          <div className="stat"><div className="k">ACTUAL</div><div className="v">{h1(d.actualTotal)}</div></div>
          <div className="stat"><div className="k">ACCURACY</div><div className="v">{d.accuracy}%</div></div>
          <div className="stat"><div className="k">FOCUS SESSIONS</div><div className="v">{d.sessions}</div></div>
        </div>

        <div className="charts">
          <div className="panel">
            <div style={{ display: 'flex', alignItems: 'flex-start' }}>
              <div><h3>Daily Capacity</h3><div className="sub-t">Planned vs. actual hours · this week (hover bars for details)</div></div>
              <div className="legend"><span><i style={{ background: 'var(--muted)' }} />Planned</span><span><i style={{ background: 'var(--accent)' }} />Actual</span></div>
            </div>
            <div className="chart" onMouseLeave={clearTip}>
              <div className="ylabels">{ticks.map((t) => <span key={t}>{Math.round(t)}h</span>)}</div>
              <div className="plot">
                {ticks.map((t, i) => <div key={t} className="gl" style={{ top: `calc((100% - 22px) * ${i / 4})` }} />)}
                <div className="bars">
                  {DAYS.map((day, i) => {
                    const p = d.planned[i] || 0;
                    const a = d.actual[i] || 0;
                    const pct = p > 0 ? Math.round((a / p) * 100) : 0;
                    const diff = Math.round((a - p) * 10) / 10;
                    return (
                      <div
                        className="day"
                        key={day}
                        onMouseMove={(e) => showTip(e, `${day} (${pct}% of plan)`, `Planned: ${h1(p)} · Actual: ${h1(a)} (${diff >= 0 ? '+' : ''}${diff}h)`)}
                      >
                        <div className="pair">
                          <i className="bar plan" style={{ height: `${(p / max) * 100}%`, alignSelf: 'flex-end' }} />
                          <i className="bar act" style={{ height: `${(a / max) * 100}%`, alignSelf: 'flex-end' }} />
                        </div>
                        <span className="dlabel">{day}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <div className="panel">
            <h3>Time Allocation</h3><div className="sub-t">Last 7 days by discipline</div>
            <Donut data={d} onTip={showTip} clearTip={clearTip} />
          </div>
        </div>

        <div className="charts even">
          <div className="panel">
            <h3>Focus trend</h3><div className="sub-t">Hours tracked per week · last 12 weeks</div>
            <Trend data={d.trend} onTip={showTip} clearTip={clearTip} />
          </div>

          <div className="panel">
            <h3>Estimate accuracy</h3>
            <div className="sub-t">Completed tasks with an estimate · last 90 days</div>
            {est.count === 0 ? <div className="empty" style={{ marginTop: 16 }}>Add estimates to tasks and complete them to see how well you predict your time.</div> : (
              <>
                <div className="est-big">
                  <b className="mono" style={{ color: est.ratio > 115 ? 'var(--amber)' : 'var(--accent)' }}>{est.ratio}%</b>
                  <span>{est.ratio > 105 ? 'Tasks usually take longer than planned' : est.ratio < 85 ? 'You usually finish faster than planned' : 'Right on target'} · {est.count} tasks</span>
                </div>
                {est.rows.map((r) => (
                  <div
                    className="est-row"
                    key={r.name}
                    style={{ cursor: 'pointer' }}
                    onMouseMove={(e) => showTip(e, `${r.name} (${r.count} tasks)`, `Estimated: ${h1(r.estimateH)} → Actual: ${h1(r.actualH)}`)}
                    onMouseLeave={clearTip}
                  >
                    <span className="tag" style={tagStyle(r.name)}>{r.name}</span>
                    <div className="est-bars"><i className="e" style={{ width: `${(r.estimateH / Math.max(r.estimateH, r.actualH, 0.1)) * 100}%` }} /><i className="a" style={{ width: `${(r.actualH / Math.max(r.estimateH, r.actualH, 0.1)) * 100}%` }} /></div>
                    <span className="meta">{h1(r.estimateH)} → {h1(r.actualH)}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>

        <div className="panel">
          <div style={{ display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
            <div><h3>Activity</h3><div className="sub-t">{h1(yearTotal)} tracked in the last 12 months</div></div>
            <div className="legend" style={{ gap: 22 }}>
              <span>Current streak <b className="mono" style={{ color: 'var(--accent)' }}>{d.streak}d</b></span>
              <span>Best streak <b className="mono" style={{ color: 'var(--text)' }}>{d.bestStreak}d</b></span>
            </div>
          </div>
          <Heatmap days={d.heatmap} onTip={showTip} clearTip={clearTip} />
        </div>
      </div></div>
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
    </>
  );
}
