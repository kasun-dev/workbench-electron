import { useStore } from '../store.jsx';
import { Modal } from './ui.jsx';

// Shown when the main process notices you were away while a timer was running
export default function IdleDialog() {
  const { idle, active, resolveIdle } = useStore();
  if (!idle || !active) return null;
  const mins = Math.max(1, Math.round(idle.idleSeconds / 60));
  const since = new Date(idle.since).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <Modal small onClose={() => resolveIdle('keep')}>
      <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h3 style={{ fontSize: 16 }}>Were you away?</h3>
        <p style={{ color: 'var(--muted)', lineHeight: 1.5 }}>
          No activity for about <b style={{ color: 'var(--text)' }}>{mins} min</b> (since {since}) while <span className="mono">{active.key}</span> was running.
          What should happen to that time?
        </p>
        <button className="btn primary block" onClick={() => resolveIdle('discard_continue')}>Discard idle time and keep working</button>
        <button className="btn block" onClick={() => resolveIdle('discard')}>Discard idle time and stop the timer</button>
        <button className="btn block" onClick={() => resolveIdle('keep')}>Keep the time</button>
      </div>
    </Modal>
  );
}
