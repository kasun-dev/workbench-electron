import { useEffect, useState } from 'react';
import { Download, LogOut, Sparkles, Upload } from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.jsx';
import { Segmented, Toggle, Topbar } from '../components/ui.jsx';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const CURRENCIES = ['LKR', 'USD', 'EUR', 'GBP', 'INR', 'AUD', 'CAD', 'AED', 'SGD', 'JPY'];
const MODELS = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite'];

function useSave() {
  const [msg, setMsg] = useState(null);
  const run = async (fn) => {
    setMsg(null);
    try { await fn(); setMsg({ ok: true, t: 'Saved' }); } catch (e) { setMsg({ ok: false, t: e.message }); }
    setTimeout(() => setMsg(null), 3500);
  };
  return [msg, run];
}
const Msg = ({ m }) => (m ? <span className={m.ok ? 'ok' : 'err'}>{m.t}</span> : null);
const Row = ({ title, hint, children }) => (
  <div className="row-between"><div><div>{title}</div>{hint && <div className="meta" style={{ marginTop: 2 }}>{hint}</div>}</div>{children}</div>
);

export default function SettingsView() {
  const { user, setUser, logout, loadAll, notify } = useStore();
  const p = user.preferences;
  const [profile, setProfile] = useState({ displayName: user.displayName, email: user.email });
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [pomo, setPomo] = useState({
    focusMinutes: p.pomodoro.focusMinutes, shortBreakMinutes: p.pomodoro.shortBreakMinutes,
    longBreakMinutes: p.pomodoro.longBreakMinutes, longBreakEvery: p.pomodoro.longBreakEvery,
  });
  const [idleMin, setIdleMin] = useState(String(p.idleMinutes ?? 10));
  const [cur, setCur] = useState(p.currency || 'LKR');
  const [plan, setPlan] = useState((p.weeklyPlan?.length === 7 ? p.weeklyPlan : [8, 8, 8, 8, 6, 3, 0]).map(String));
  const [sys, setSys] = useState(null);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('gemini-2.5-flash');
  const [testingAi, setTestingAi] = useState(false);
  const [m1, save1] = useSave(); const [m2, save2] = useSave(); const [m3, save3] = useSave();
  const [m4, save4] = useSave(); const [m5, save5] = useSave(); const [mAi, saveAi] = useSave();

  useEffect(() => {
    api.system.get().then((s) => { setSys(s); if (s?.geminiModel) setModel(s.geminiModel); }).catch(() => {});
  }, []);

  const prefs = (patch) => api.user.updatePreferences(patch).then(setUser);
  const setSystem = (patch) => api.system.set(patch).then(setSys).catch((e) => notify(e.message));

  const saveGemini = () => saveAi(async () => {
    const patch = { geminiModel: model };
    if (apiKey.trim()) patch.geminiApiKey = apiKey.trim();
    const next = await api.system.set(patch);
    setSys(next);
    setApiKey('');
  });

  const testGemini = async () => {
    setTestingAi(true);
    try {
      if (apiKey.trim()) {
        const next = await api.system.set({ geminiApiKey: apiKey.trim(), geminiModel: model });
        setSys(next);
        setApiKey('');
      }
      const r = await api.ai.test();
      notify(`Gemini connected (${r.model})`);
    } catch (e) { notify(e.message); } finally { setTestingAi(false); }
  };

  const backup = async () => {
    try { const r = await api.data.backup(); if (r.saved) notify(`Backup saved (${r.counts.tasks} tasks, ${r.counts.timeLogs} time logs, ${r.counts.transactions} transactions)`); }
    catch (e) { notify(e.message); }
  };
  const restore = async () => {
    try { const r = await api.data.restore(); if (r.restored) { await loadAll(); notify(`Restored ${r.counts.tasks} tasks, ${r.counts.goals} goals, ${r.counts.transactions} transactions`); } }
    catch (e) { notify(e.message); }
  };

  return (
    <>
      <Topbar title="Settings" />
      <div className="view"><div className="page settings">
        <div className="card-s">
          <h3><Sparkles size={15} style={{ color: 'var(--purple)', marginRight: 6, verticalAlign: '-2px' }} />Gemini AI</h3>
          <p>Encrypted locally on this device via OS keychain. Powers smart capture, voice notes, breakdowns, estimates, coaching, finance insights and semantic search.</p>
          <div className="grid2">
            <label className="fl">
              <span>Gemini API Key {sys?.hasApiKey && <em className="ok">({sys.maskedApiKey} active)</em>}</span>
              <input className="field mono" type="password" placeholder={sys?.hasApiKey ? 'Paste new key to replace…' : 'AIzaSy…'}
                value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
            </label>
            <label className="fl">
              <span>Model</span>
              <input className="field mono" list="ai-models" value={model} onChange={(e) => setModel(e.target.value)} />
              <datalist id="ai-models">{MODELS.map((m) => <option key={m} value={m} />)}</datalist>
            </label>
          </div>
          <div className="actions">
            <button className="btn primary" onClick={saveGemini}>Save AI settings</button>
            <button className="btn" disabled={testingAi} onClick={testGemini}>{testingAi ? 'Testing…' : 'Test connection'}</button>
            {sys?.hasApiKey && <button className="btn danger" onClick={() => setSystem({ geminiApiKey: '' })}>Clear key</button>}
            <Msg m={mAi} />
          </div>
        </div>

        <div className="card-s">
          <h3>Profile</h3><p>How you appear in the app.</p>
          <div className="grid2">
            <label className="fl"><span>Name</span><input className="field" value={profile.displayName} onChange={(e) => setProfile({ ...profile, displayName: e.target.value })} /></label>
            <label className="fl"><span>Email</span><input className="field" type="email" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} /></label>
          </div>
          <div className="actions"><button className="btn primary" onClick={() => save1(() => api.user.updateProfile(profile).then(setUser))}>Save profile</button><Msg m={m1} /></div>
        </div>

        <div className="card-s">
          <h3>Password</h3><p>Use at least 8 characters.</p>
          <div className="grid2">
            <label className="fl"><span>Current password</span><input className="field" type="password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} /></label>
            <span />
            <label className="fl"><span>New password</span><input className="field" type="password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} /></label>
            <label className="fl"><span>Confirm new password</span><input className="field" type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></label>
          </div>
          <div className="actions">
            <button className="btn primary" onClick={() => save2(async () => {
              if (pw.newPassword !== pw.confirm) throw new Error('Passwords do not match');
              await api.user.changePassword({ currentPassword: pw.currentPassword, newPassword: pw.newPassword });
              setPw({ currentPassword: '', newPassword: '', confirm: '' });
            })}>Change password</button><Msg m={m2} />
          </div>
        </div>

        <div className="card-s">
          <h3>Appearance</h3><p>Applies instantly.</p>
          <Segmented value={p.theme} onChange={(theme) => save3(() => prefs({ theme }))}
            options={[{ id: 'dark', label: 'Dark' }, { id: 'light', label: 'Light' }, { id: 'system', label: 'System' }]} />
          <div className="actions"><Msg m={m3} /></div>
        </div>

        <div className="card-s">
          <h3>Focus timer</h3><p>Pomodoro mode stops the timer when a focus session ends and runs your break.</p>
          <Row title="Pomodoro mode" hint="Focus / break cycles in the sidebar timer"><Toggle on={!!p.pomodoro.enabled} onChange={(v) => prefs({ pomodoro: { enabled: v } })} /></Row>
          <Row title="Auto-start breaks"><Toggle on={p.autoStartBreaks} onChange={(v) => prefs({ autoStartBreaks: v })} /></Row>
          <div className="grid2" style={{ marginTop: 16 }}>
            {[['focusMinutes', 'Focus (min)'], ['shortBreakMinutes', 'Short break (min)'], ['longBreakMinutes', 'Long break (min)'], ['longBreakEvery', 'Long break every (sessions)']].map(([k, label]) => (
              <label className="fl" key={k}><span>{label}</span>
                <input className="field" type="number" min="1" value={pomo[k]} onChange={(e) => setPomo({ ...pomo, [k]: e.target.value })} /></label>
            ))}
            <label className="fl"><span>Idle detection (minutes, 0 = off)</span>
              <input className="field" type="number" min="0" max="240" value={idleMin} onChange={(e) => setIdleMin(e.target.value)} /></label>
          </div>

          <h3 style={{ marginTop: 22 }}>Weekly plan</h3><p>Planned hours per day. Drives the Planned bars, Accuracy and your Today capacity.</p>
          <div className="grid7">
            {DAYS.map((d, i) => (
              <label key={d} className="fl"><label>{d}</label>
                <input className="field" type="number" min="0" max="24" step="0.5" value={plan[i]} onChange={(e) => setPlan(plan.map((v, j) => (j === i ? e.target.value : v)))} /></label>
            ))}
          </div>
          <div className="actions">
            <button className="btn primary" onClick={() => save4(() => prefs({
              pomodoro: Object.fromEntries(Object.entries(pomo).map(([k, v]) => [k, Number(v)])),
              idleMinutes: Number(idleMin), weeklyPlan: plan.map(Number),
            }))}>Save timer &amp; plan</button><Msg m={m4} />
          </div>
        </div>

        <div className="card-s">
          <h3>Finance</h3><p>Used to format every amount on the Finance page.</p>
          <div className="grid2">
            <label className="fl"><span>Currency code</span>
              <input className="field" list="cur-list" maxLength={8} value={cur} onChange={(e) => setCur(e.target.value.toUpperCase())} />
              <datalist id="cur-list">{CURRENCIES.map((c) => <option key={c} value={c} />)}</datalist></label>
          </div>
          <div className="actions"><button className="btn primary" onClick={() => save5(() => prefs({ currency: cur }))}>Save currency</button><Msg m={m5} /></div>
        </div>

        <div className="card-s">
          <h3>Desktop</h3><p>These apply to this computer only.</p>
          {sys && (
            <>
              <Row title="Keep running in the background when closed" hint="The close button hides Workbench to the tray so your timer keeps going. Quit from the tray menu.">
                <Toggle on={sys.runInBackground} onChange={(v) => setSystem({ runInBackground: v })} /></Row>
              <Row title="Floating timer" hint="Small always-on-top window with the running timer"><Toggle on={sys.miniTimer} onChange={(v) => setSystem({ miniTimer: v })} /></Row>
              <Row title="Global shortcuts" hint="Ctrl/Cmd+Shift+T starts or stops the timer · Ctrl/Cmd+Shift+N opens Quick Capture, from any app">
                <Toggle on={sys.globalShortcuts} onChange={(v) => setSystem({ globalShortcuts: v })} /></Row>
              <Row title="Launch at login" hint={sys.packaged ? 'Starts Workbench when you sign in to your computer' : 'Only works in the installed app, not in dev mode'}>
                <Toggle on={sys.launchAtLogin} onChange={(v) => setSystem({ launchAtLogin: v })} /></Row>
              <Row title="Start minimized to the tray" hint="When launching at login, don't open the window"><Toggle on={sys.startHidden} onChange={(v) => setSystem({ startHidden: v })} /></Row>
            </>
          )}
        </div>

        <div className="card-s">
          <h3>Backup &amp; restore</h3><p>Everything (tasks, time logs, goals, finance) in one JSON file. Restoring replaces your current data.</p>
          <div className="actions" style={{ marginTop: 0 }}>
            <button className="btn" onClick={backup}><Download size={14} />Download backup</button>
            <button className="btn" onClick={restore}><Upload size={14} />Restore from backup</button>
          </div>
        </div>

        <div className="card-s">
          <h3>Keyboard shortcuts</h3>
          <div className="kbd-list">
            <span><kbd>Ctrl K</kbd> Command palette</span><span><kbd>Ctrl N</kbd> Quick capture</span>
            <span><kbd>Ctrl 1-7</kbd> Switch view</span><span><kbd>Ctrl</kbd>+click Multi-select cards</span>
            <span><kbd>Esc</kbd> Close / clear selection</span><span><kbd>Ctrl Shift T</kbd> Start/stop timer (global)</span>
          </div>
        </div>

        <div className="card-s">
          <h3>Account</h3><p>Signed in as {user.email}.</p>
          <button className="btn danger" onClick={logout}><LogOut size={15} />Sign out</button>
        </div>
      </div></div>
    </>
  );
}
