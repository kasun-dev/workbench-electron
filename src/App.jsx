import { useEffect } from 'react';
import { useStore } from './store.jsx';
import Sidebar from './components/Sidebar.jsx';
import QuickCapture from './components/QuickCapture.jsx';
import CommandPalette from './components/CommandPalette.jsx';
import IdleDialog from './components/IdleDialog.jsx';
import Auth from './views/Auth.jsx';
import Board from './views/Board.jsx';
import TaskModal from './views/TaskModal.jsx';
import Today from './views/Today.jsx';
import Analytics from './views/Analytics.jsx';
import Review from './views/Review.jsx';
import Finance from './views/Finance.jsx';
import { Goals, GoalModal } from './views/Goals.jsx';
import SettingsView from './views/Settings.jsx';

const VIEW_KEYS = ['board', 'today', 'goals', 'analytics', 'review', 'finance', 'settings'];

export default function App() {
  const { user, view, setView, toast, openTaskId, openGoalId, captureOpen, setCaptureOpen, paletteOpen, setPaletteOpen } = useStore();

  useEffect(() => {
    const h = (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'k') { e.preventDefault(); setPaletteOpen((o) => !o); }
      else if (k === 'n') { e.preventDefault(); setCaptureOpen((o) => !o); }
      else if (/^[1-7]$/.test(k)) { e.preventDefault(); setView(VIEW_KEYS[Number(k) - 1]); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [setCaptureOpen, setPaletteOpen, setView]);

  if (user === undefined) return <div className="boot" />;
  if (!user) return <><Auth />{toast && <div className="toast">{toast}</div>}</>;

  return (
    <div className="app">
      <Sidebar />
      <main>
        {view === 'board' && <Board />}
        {view === 'today' && <Today />}
        {view === 'goals' && <Goals />}
        {view === 'analytics' && <Analytics />}
        {view === 'review' && <Review />}
        {view === 'finance' && <Finance />}
        {view === 'settings' && <SettingsView />}
      </main>
      {openTaskId && <TaskModal />}
      {openGoalId && <GoalModal />}
      {captureOpen && <QuickCapture />}
      {paletteOpen && <CommandPalette />}
      <IdleDialog />
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
