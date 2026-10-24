import { useMemo, useRef, useState } from 'react';
import { Mic, Square, Sparkles } from 'lucide-react';
import { Modal, Segmented, Select } from './ui.jsx';
import { api } from '../api.js';
import { useStore } from '../store.jsx';
import { PRIORITIES } from '../lib.js';

export default function QuickCapture() {
  const { tasks, goals, createTask, createGoal, setCaptureOpen, setView, setOpenTaskId, notify } = useStore();
  const [mode, setMode] = useState('task');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [discipline, setDiscipline] = useState('');
  const [priority, setPriority] = useState('medium');
  const [dueDate, setDueDate] = useState('');
  const [estimateMinutes, setEstimateMinutes] = useState('');
  const [estHint, setEstHint] = useState(null);
  const [voiceCards, setVoiceCards] = useState(null);
  const [busy, setBusy] = useState(false);
  const [rec, setRec] = useState(false);
  const mediaRef = useRef(null);

  const cats = useMemo(() => [...new Set([...tasks, ...goals].map((x) => x.category).filter(Boolean))], [tasks, goals]);

  const smartParse = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      const r = await api.ai.parseCapture(title.trim());
      if (r.mode) setMode(r.mode);
      if (r.title) setTitle(r.title);
      if (r.category) setCategory(r.category);
      if (r.discipline) setDiscipline(r.discipline);
      if (r.priority) setPriority(r.priority);
      if (r.dueDate) setDueDate(r.dueDate);
      if (r.estimateMinutes > 0) setEstimateMinutes(String(r.estimateMinutes));
      const est = await api.ai.estimate({ title: r.title || title, category: r.category || category }).catch(() => null);
      if (est?.matchedCount > 0) setEstHint(est);
    } catch (e) { notify(e.message); } finally { setBusy(false); }
  };

  const autoCat = async () => {
    if (!title.trim() || category) return;
    try {
      const r = await api.ai.categorize(title.trim());
      if (r.category) setCategory(r.category);
      if (r.discipline) setDiscipline(r.discipline);
    } catch { /* silent on blur */ }
  };

  const toggleVoice = async () => {
    if (rec && mediaRef.current) {
      mediaRef.current.stop();
      setRec(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      const chunks = [];
      mr.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64 = String(reader.result || '').split(',')[1];
          if (!base64) return;
          setBusy(true);
          try {
            const res = await api.ai.voiceCapture({ audioBase64: base64, mimeType: blob.type || 'audio/webm' });
            if (res.tasks?.length === 1) {
              const t = res.tasks[0];
              setTitle(t.title); setCategory(t.category || ''); setDiscipline(t.discipline || '');
              setPriority(t.priority || 'medium'); setDueDate(t.dueDate || '');
              if (t.estimateMinutes > 0) setEstimateMinutes(String(t.estimateMinutes));
            } else if (res.tasks?.length > 1) {
              setVoiceCards(res.tasks);
            }
          } catch (e) { notify(e.message); } finally { setBusy(false); }
        };
        reader.readAsDataURL(blob);
      };
      mediaRef.current = mr;
      mr.start();
      setRec(true);
    } catch (e) { notify('Microphone access denied or unavailable'); }
  };

  const createVoiceBatch = async () => {
    if (!voiceCards?.length) return;
    setBusy(true);
    try {
      for (const c of voiceCards) {
        await createTask({
          title: c.title, category: c.category || '', discipline: c.discipline || '',
          priority: c.priority || 'medium', dueDate: c.dueDate || null, estimateMinutes: Number(c.estimateMinutes) || 0,
        });
      }
      notify(`Created ${voiceCards.length} tasks from voice`);
      setCaptureOpen(false);
    } finally { setBusy(false); }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    const sib = [...tasks, ...goals].find((x) => x.category === category && x.discipline);
    const data = {
      title: title.trim(),
      category: category.trim(),
      priority,
      discipline: discipline.trim() || sib?.discipline || '',
      ...(mode === 'task' ? { dueDate: dueDate || null, estimateMinutes: Number(estimateMinutes) || 0 } : { targetDate: dueDate || null }),
    };
    if (mode === 'goal') { await createGoal(data); setView('goals'); setCaptureOpen(false); return; }
    const t = await createTask(data);
    setCaptureOpen(false);
    if (t) setOpenTaskId(t._id);
  };

  return (
    <Modal small onClose={() => setCaptureOpen(false)}>
      <form onSubmit={submit} style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Segmented value={mode} onChange={setMode} options={[{ id: 'task', label: 'Task' }, { id: 'goal', label: 'Long-term goal' }]} />
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <button type="button" className={`ai-btn ${rec ? 'rec' : ''}`} disabled={busy} onClick={toggleVoice} title="Dictate one or multiple tasks">
              {rec ? <><Square size={12} />Stop</> : <><Mic size={13} />Voice</>}
            </button>
            <button type="button" className="ai-btn" disabled={busy || !title.trim()} onClick={smartParse} title="Extract date, estimate, priority & category">
              <Sparkles size={13} />{busy ? 'Thinking…' : 'AI Parse'}
            </button>
          </div>
        </div>

        <input className="modal-title" autoFocus style={{ marginBottom: 0 }}
          placeholder={mode === 'task' ? 'e.g. "fix fork seal Friday 2h high, Yamaha"' : 'What do you want to do someday?'}
          value={title} onChange={(e) => setTitle(e.target.value)} onBlur={autoCat} />

        {estHint && (
          <button type="button" className="ai-chip" onClick={() => setEstimateMinutes(String(estHint.estimateMinutes))}>
            <Sparkles size={13} style={{ color: 'var(--purple)' }} />
            <span>{estHint.message} — <b>Click to set {estHint.estimateMinutes}m</b></span>
          </button>
        )}

        {voiceCards ? (
          <div className="ai-box">
            <h4><Sparkles size={14} /> Dictated Tasks ({voiceCards.length})</h4>
            {voiceCards.map((c, i) => (
              <div key={i} className="trow" style={{ cursor: 'default' }}>
                <span className="ttl">{c.title}</span>
                {c.category && <span className="meta">{c.category}</span>}
                {c.estimateMinutes > 0 && <span className="meta">{c.estimateMinutes}m</span>}
                <span className="meta">{c.priority}</span>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn primary block" disabled={busy} onClick={createVoiceBatch}>Create all {voiceCards.length} tasks</button>
              <button type="button" className="btn" onClick={() => setVoiceCards(null)}>Discard</button>
            </div>
          </div>
        ) : (
          <>
            <div className="grid2">
              <div><div className="label">Category</div>
                <input className="field" list="cap-cats" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Axceera Dev" />
                <datalist id="cap-cats">{cats.map((c) => <option key={c} value={c} />)}</datalist></div>
              <div><div className="label">Priority</div><Select value={priority} options={PRIORITIES} onChange={setPriority} /></div>
            </div>
            {mode === 'task' && (
              <div className="grid2">
                <div><div className="label">Due date</div><input className="field" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
                <div><div className="label">Estimate (min)</div><input className="field" type="number" min="0" step="5" value={estimateMinutes} onChange={(e) => setEstimateMinutes(e.target.value)} placeholder="e.g. 120" /></div>
              </div>
            )}
            <button className="btn primary block" type="submit">{mode === 'task' ? 'Create task' : 'Save goal'}</button>
          </>
        )}
      </form>
    </Modal>
  );
}
