import { useMemo, useState } from 'react';
import { Modal, Segmented, Select } from './ui.jsx';
import { useStore } from '../store.jsx';
import { PRIORITIES } from '../lib.js';

export default function QuickCapture() {
  const { tasks, goals, createTask, createGoal, setCaptureOpen, setView, setOpenTaskId } = useStore();
  const [mode, setMode] = useState('task');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [priority, setPriority] = useState('medium');
  const cats = useMemo(() => [...new Set([...tasks, ...goals].map((x) => x.category).filter(Boolean))], [tasks, goals]);

  const submit = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    // inherit discipline from an existing item in the same category so Analytics stays tidy
    const sib = [...tasks, ...goals].find((x) => x.category === category && x.discipline);
    const data = { title: title.trim(), category: category.trim(), priority, discipline: sib?.discipline || '' };
    if (mode === 'goal') { await createGoal(data); setView('goals'); setCaptureOpen(false); return; }
    const t = await createTask(data);
    setCaptureOpen(false);
    if (t) setOpenTaskId(t._id);
  };

  return (
    <Modal small onClose={() => setCaptureOpen(false)}>
      <form onSubmit={submit} style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Segmented value={mode} onChange={setMode} options={[{ id: 'task', label: 'Task' }, { id: 'goal', label: 'Long-term goal' }]} />
        <input className="modal-title" autoFocus style={{ marginBottom: 0 }} placeholder={mode === 'task' ? 'What needs doing?' : 'What do you want to do someday?'}
          value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="grid2">
          <div><div className="label">Category</div>
            <input className="field" list="cap-cats" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Axceera Dev" />
            <datalist id="cap-cats">{cats.map((c) => <option key={c} value={c} />)}</datalist></div>
          <div><div className="label">Priority</div><Select value={priority} options={PRIORITIES} onChange={setPriority} /></div>
        </div>
        <button className="btn primary block" type="submit">{mode === 'task' ? 'Create task' : 'Save goal'}</button>
      </form>
    </Modal>
  );
}
