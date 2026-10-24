import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.jsx';
import { Modal, Topbar } from '../components/ui.jsx';
import { tagStyle, todayStr } from '../lib.js';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const COLORS = ['var(--accent)', 'var(--blue)', 'var(--pink)', 'var(--amber)', 'var(--purple)', 'var(--muted)'];
const h1 = (n) => `${(n ?? 0).toFixed(1)}h`;

function Donut({ data }) {
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
  return (
    <>
      <div className="donut">
        <svg viewBox="0 0 200 200"><g transform="rotate(-90 100 100)">
          <circle cx="100" cy="100" r={R} fill="none" stroke="var(--border)" strokeWidth="18" />
          {segs.map((s) => <circle key={s.name} cx="100" cy="100" r={R} fill="none" stroke={s.color} strokeWidth="18" strokeDasharray={s.dash} strokeDashoffset={s.offset} />)}
        </g></svg>
        <div className="mid"><b>{h1(data.allocationTotal)}</b><span>TRACKED</span></div>
      </div>
      {segs.length === 0 && <div className="empty">Track some time to see your split</div>}
      {segs.map((s) => (
        <div className="lg" key={s.name}>
          <span><i style={{ background: s.color }} />{s.name}</span><span className="h">{h1(s.hours)}</span><span className="p">{s.pct}%</span>
        </div>
      ))}
    </>
  );
}

function Trend({ data }) {
  const W = 420, H = 130, P = 16;
  const max = Math.max(1, ...data.map((d) => d.hours));
  const pts = data.map((d, i) => [P + (i * (W - P * 2)) / (data.length - 1), H - P - (d.hours / max) * (H - P * 2)]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H + 18}`} className="trend">
      <path d={`${line} L${pts[pts.length - 1][0]},${H - P} L${pts[0][0]},${H - P} Z`} fill="var(--accent)" opacity="0.12" />
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />
      {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="2.5" fill="var(--accent)"><title>{`${data[i].label}: ${data[i].hours}h`}</title></circle>)}
      {data.map((d, i) => (i % 2 === 0 || i === data.length - 1) && <text key={i} x={pts[i][0]} y={H + 10} textAnchor="middle" fontSize="9" fill="var(--muted)" fontFamily="var(--mono)">{d.label}</text>)}
    </svg>
  );
}

function Heatmap({ days }) {
  const first = new Date(`${days[0].d}T12:00:00`);
  const pad = (first.getDay() + 6) % 7; // Monday-first
  const lvl = (h) => (h <= 0 ? 0 : h < 1 ? 1 : h < 3 ? 2 : h < 5 ? 3 : 4);
  return (
    <div className="heat-wrap">
      <div className="heat">
        {Array.from({ length: pad }, (_, i) => <i key={`p${i}`} className="hc blank" />)}
        {days.map((d) => <i key={d.d} className={`hc l${lvl(d.h)}`} title={`${d.d}: ${d.h}h`} />)}
      </div>
    </div>
  );
}

function ExportDialog({ onClose }) {
  const { notify } = useStore();
  const t = todayStr();
  const [from, setFrom] = useState(`${t.slice(0, 8)}01`);
  const [to, setTo] = useState(t);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const r = await api.data.exportTimesheet({ from, to });
      if (r.saved) { notify(`Exported ${r.count} entries (${r.hours}h)`); onClose(); }
    } catch (e) { notify(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal small onClose={onClose}>
      <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h3 style={{ fontSize: 16 }}>Export timesheet (CSV)</h3>
        <div className="grid2">
          <label className="fl"><span>From</span><input className="field" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="fl"><span>To</span><input className="field" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        <p className="meta">One row per tracked session with task, category, discipline and duration. Opens in Excel or Sheets.</p>
        <button className="btn primary block" disabled={busy} onClick={go}><Download size={14} />Export CSV</button>
      </div>
    </Modal>
  );
}

export default function Analytics() {
  const { active, notify } = useStore();
  const [d, setD] = useState(null);
  const [exporting, setExporting] = useState(false);
  useEffect(() => { api.analytics.summary().then(setD).catch((e) => notify(e.message)); }, [active?.logId]); // eslint-disable-line

  if (!d) return <Topbar title="Analytics" />;
  const max = Math.max(12, Math.ceil(Math.max(...d.planned, ...d.actual) / 4) * 4);
  const ticks = [0, 1, 2, 3, 4].map((i) => max - (max / 4) * i);
  const est = d.estimate;
  const yearTotal = d.heatmap.reduce((a, x) => a + x.h, 0);

  return (
    <>
      <Topbar title="Analytics">
        <button className="btn" onClick={() => setExporting(true)}><Download size={14} />Export timesheet</button>
      </Topbar>
      <div className="view"><div className="page">
        <div className="stats">
          <div className="stat"><div className="k">PLANNED</div><div className="v">{h1(d.plannedTotal)}</div></div>
          <div className="stat"><div className="k">ACTUAL</div><div className="v">{h1(d.actualTotal)}</div></div>
          <div className="stat"><div className="k">ACCURACY</div><div className="v">{d.accuracy}%</div></div>
          <div className="stat"><div className="k">FOCUS SESSIONS</div><div className="v">{d.sessions}</div></div>
        </div>
        <div className="charts">
          <div className="panel">
            <div style={{ display: 'flex', alignItems: 'flex-start' }}>
              <div><h3>Daily Capacity</h3><div className="sub-t">Planned vs. actual hours · this week</div></div>
              <div className="legend"><span><i style={{ background: 'var(--muted)' }} />Planned</span><span><i style={{ background: 'var(--accent)' }} />Actual</span></div>
            </div>
            <div className="chart">
              <div className="ylabels">{ticks.map((t) => <span key={t}>{Math.round(t)}h</span>)}</div>
              <div className="plot">
                {ticks.map((t, i) => <div key={t} className="gl" style={{ top: `calc((100% - 22px) * ${i / 4})` }} />)}
                <div className="bars">
                  {DAYS.map((day, i) => (
                    <div className="day" key={day}>
                      <div className="pair">
                        <i className="bar plan" style={{ height: `${(d.planned[i] / max) * 100}%`, alignSelf: 'flex-end' }} />
                        <i className="bar act" style={{ height: `${(d.actual[i] / max) * 100}%`, alignSelf: 'flex-end' }} />
                      </div>
                      <span className="dlabel">{day}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <div className="panel">
            <h3>Time Allocation</h3><div className="sub-t">Last 7 days by discipline</div>
            <Donut data={d} />
          </div>
        </div>

        <div className="charts even">
          <div className="panel">
            <h3>Focus trend</h3><div className="sub-t">Hours tracked per week · last 12 weeks</div>
            <Trend data={d.trend} />
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
                  <div className="est-row" key={r.name}>
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
          <Heatmap days={d.heatmap} />
        </div>
      </div></div>
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
    </>
  );
}
