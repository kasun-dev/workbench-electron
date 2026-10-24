import { useEffect, useRef, useState } from 'react';
import { BarChart3, CalendarCheck, ClipboardCheck, PictureInPicture2, Play, Plus, Settings, Square, SquareKanban, Target, Wallet } from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.jsx';
import { useNow } from '../hooks.js';
import { hms, isMac, notifyDesktop } from '../lib.js';

function TimerPanel() {
  const { active, stopTimer, startTimer, lastTaskId, user } = useStore();
  const prefs = user.preferences;
  const pm = prefs.pomodoro;
  const pomoOn = !!pm.enabled;
  const [brk, setBrk] = useState(null);   // { kind, len, until|null } while on a break
  const [count, setCount] = useState(0);  // focus sessions completed (this app run)
  const handled = useRef(null);
  const now = useNow(!!active || !!brk);
  const elapsed = active ? (now - Date.parse(active.startTime)) / 1000 : 0;
  const focusSec = pm.focusMinutes * 60;

  useEffect(() => { if (active) setBrk(null); }, [active?.logId]); // eslint-disable-line

  useEffect(() => {
    if (active && elapsed >= focusSec && handled.current !== active.logId) {
      handled.current = active.logId;
      notifyDesktop('Focus session complete', `${active.key} · ${pm.focusMinutes} min`);
      if (pomoOn) {
        const n = count + 1;
        setCount(n);
        const kind = n % pm.longBreakEvery === 0 ? 'long' : 'short';
        const len = (kind === 'long' ? pm.longBreakMinutes : pm.shortBreakMinutes) * 60;
        stopTimer().then(() => setBrk({ kind, len, until: prefs.autoStartBreaks ? Date.now() + len * 1000 : null }));
      }
    }
    if (brk?.until && Date.now() >= brk.until) {
      notifyDesktop('Break over', 'Ready for the next focus session.');
      setBrk(null);
    }
  });

  let label = active ? 'RUNNING' : 'IDLE';
  let clock = elapsed;
  if (active && pomoOn) { label = `FOCUS #${count + 1}`; clock = Math.max(0, focusSec - elapsed); }
  if (brk) { label = `${brk.kind.toUpperCase()} BREAK`; clock = brk.until ? Math.max(0, (brk.until - now) / 1000) : brk.len; }
  if (!active && !brk) clock = 0;

  return (
    <div className="timer-panel">
      <div className="tp-status">
        <span className={`dot ${active || brk?.until ? 'live' : ''}`} />{label}
        <button className="tp-mini" title="Floating timer" onClick={() => api.system.toggleMini().catch(() => {})}><PictureInPicture2 size={13} /></button>
      </div>
      {active && <div className="tp-task"><b>{active.key}</b>{active.title}</div>}
      {!active && !brk && <div className="tp-hint">Press <Play size={10} /> on any card to start.</div>}
      {brk && !brk.until && (
        <div className="tp-hint">
          <button className="mini-btn" onClick={() => setBrk({ ...brk, until: Date.now() + brk.len * 1000 })}>Start break</button>
          <button className="tp-skip" onClick={() => setBrk(null)}>Skip</button>
        </div>
      )}
      <div className="tp-row">
        <span className="tp-clock">{hms(clock)}</span>
        <button className="tp-btn play" disabled={!!active || !lastTaskId} onClick={() => startTimer(lastTaskId)} title="Resume last task"><Play size={14} /></button>
        <button className="tp-btn" disabled={!active} onClick={() => stopTimer()} title="Stop"><Square size={13} /></button>
      </div>
    </div>
  );
}

export default function Sidebar() {
  const { view, setView, setCaptureOpen } = useStore();
  const nav = [
    { id: 'board', label: 'Kanban Board', icon: SquareKanban },
    { id: 'today', label: 'Today', icon: CalendarCheck },
    { id: 'goals', label: 'Long-Term Goals', icon: Target },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
    { id: 'review', label: 'Weekly Review', icon: ClipboardCheck },
    { id: 'finance', label: 'Finance', icon: Wallet },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];
  return (
    <aside className="sidebar">
      <div className="brand"><div className="logo">~</div><b>Workbench</b><span className="ver">v1.0</span></div>
      <button className="qc" onClick={() => setCaptureOpen(true)}>
        <Plus size={16} /> Quick Capture <span className="kbd">{isMac ? '⌘ N' : 'Ctrl N'}</span>
      </button>
      <div className="nav-label">WORKSPACE</div>
      {nav.map(({ id, label, icon: Icon }, i) => (
        <button key={id} className={`nav-item ${view === id ? 'active' : ''}`} onClick={() => setView(id)} title={`${isMac ? '⌘' : 'Ctrl'}+${i + 1}`}>
          <Icon size={17} />{label}
        </button>
      ))}
      <div className="grow" />
      <TimerPanel />
    </aside>
  );
}
