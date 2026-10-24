export const STATUSES = [
  { id: 'backlog', label: 'Backlog' },
  { id: 'up_next', label: 'Up Next' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'completed', label: 'Completed' },
];
export const PRIORITIES = [
  { id: 'high', label: 'High' },
  { id: 'medium', label: 'Medium' },
  { id: 'low', label: 'Low' },
];
export const GOAL_STATUSES = [
  { id: 'someday', label: 'Someday' },
  { id: 'in_motion', label: 'In motion' },
  { id: 'achieved', label: 'Achieved' },
  { id: 'archived', label: 'Archived' },
];
export const REPEATS = [
  { id: 'none', label: 'No repeat' },
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
];

export const pad = (n) => String(n).padStart(2, '0');
export const hms = (s) => {
  s = Math.max(0, Math.floor(s));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
};
export const hm = (s) => {
  s = Math.max(0, Math.floor(s));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}`;
};
export const fmtDateTime = (iso) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });

// ---- dates (all local time; due dates and finance dates are plain YYYY-MM-DD strings) ----
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayStr = () => ymd(new Date());
export const curMonth = () => todayStr().slice(0, 7);
export function shiftMonth(m, delta) {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
export function monthLabel(m) {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}
export const shortDate = (s) => new Date(`${s}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

// datetime-local <input> helpers
export const toLocalInput = (iso) => {
  const d = new Date(iso);
  return `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};
export const fromLocalInput = (v) => new Date(v).toISOString();

export function dueInfo(due) {
  if (!due) return null;
  const diff = Math.round((new Date(`${due}T12:00:00`) - new Date(`${todayStr()}T12:00:00`)) / 864e5);
  let label = shortDate(due);
  if (diff === 0) label = 'Today'; else if (diff === 1) label = 'Tomorrow'; else if (diff === -1) label = 'Yesterday';
  return { label, cls: diff < 0 ? 'overdue' : diff === 0 ? 'today' : '', diff };
}

export function money(n, cur = 'LKR') {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, minimumFractionDigits: 2 }).format(n || 0);
  } catch {
    return `${cur} ${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
  }
}

// Stable colour per category name (see .tag in styles.css)
const HUES = [210, 150, 28, 265, 0, 330, 48, 180];
export function tagStyle(name = '') {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return { '--tag-h': name ? HUES[h % HUES.length] : 0, '--tag-s': name ? '75%' : '0%' };
}

export const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
export const notifyDesktop = (title, body) => { try { new Notification(title, { body }); } catch { /* ignore */ } };
