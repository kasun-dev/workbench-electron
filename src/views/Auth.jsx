import { useState } from 'react';
import { useStore } from '../store.jsx';
import { Segmented } from '../components/ui.jsx';

export default function Auth() {
  const { login, register } = useStore();
  const [mode, setMode] = useState('login');
  const [f, setF] = useState({ displayName: '', email: '', password: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      if (mode === 'login') await login(f.email, f.password);
      else await register(f);
    } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };

  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand"><div className="logo">~</div><b>Workbench</b><span className="ver">v0.9</span></div>
        <Segmented value={mode} onChange={(m) => { setMode(m); setErr(''); }} options={[{ id: 'login', label: 'Sign in' }, { id: 'register', label: 'Create account' }]} />
        {mode === 'register' && <label className="fl"><span>Name</span><input className="field" autoFocus value={f.displayName} onChange={set('displayName')} /></label>}
        <label className="fl"><span>Email</span><input className="field" type="email" autoFocus={mode === 'login'} value={f.email} onChange={set('email')} /></label>
        <label className="fl"><span>Password {mode === 'register' && '(min 8 characters)'}</span><input className="field" type="password" value={f.password} onChange={set('password')} /></label>
        {err && <div className="err">{err}</div>}
        <button className="btn primary block" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
      </form>
    </div>
  );
}
