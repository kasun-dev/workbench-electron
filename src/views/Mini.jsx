import { useEffect, useState } from 'react';
import { Play, Square, X } from 'lucide-react';
import { api } from '../api.js';
import { useNow } from '../hooks.js';
import { hms } from '../lib.js';

// Floating always-on-top timer (separate window, same bundle, loaded with #mini)
export default function Mini() {
  const [s, setS] = useState({ ready: false, signedIn: false, a: null });
  const load = async () => {
    try {
      const u = await api.auth.session();
      if (!u) return setS({ ready: true, signedIn: false, a: null });
      setS({ ready: true, signedIn: true, a: await api.timer.active() });
    } catch { setS((x) => ({ ...x, ready: true })); }
    return undefined;
  };
  useEffect(() => {
    load();
    const off = api.events.on('timer:changed', load);
    const id = setInterval(load, 30000);
    return () => { off(); clearInterval(id); };
  }, []);

  const now = useNow(!!s.a);
  const elapsed = s.a ? (now - Date.parse(s.a.log.startTime)) / 1000 : 0;

  return (
    <div className="mini-card">
      <div className="mini-info">
        {!s.signedIn ? <div className="mini-title">Sign in from the main window</div> : s.a ? (
          <><div className="mini-key">{s.a.task.key}</div><div className="mini-title">{s.a.task.title}</div></>
        ) : <div className="mini-title">No timer running</div>}
        <div className="mini-clock">{hms(elapsed)}</div>
      </div>
      {s.signedIn && (
        <button className={`tp-btn ${s.a ? '' : 'play'}`} title={s.a ? 'Stop' : 'Resume last task'} onClick={() => api.timer.toggle().then(load).catch(() => {})}>
          {s.a ? <Square size={13} /> : <Play size={14} />}
        </button>
      )}
      <button className="tp-btn" title="Close" onClick={() => window.close()}><X size={14} /></button>
    </div>
  );
}
