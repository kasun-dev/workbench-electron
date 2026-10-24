import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronsUp, Equal } from 'lucide-react';

export function useOutside(ref, onOut) {
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onOut(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [ref, onOut]);
}

export function Select({ value, options, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useOutside(ref, () => setOpen(false));
  const cur = options.find((o) => o.id === value);
  return (
    <div className="select" ref={ref}>
      <button type="button" className="select-btn" onClick={() => setOpen((o) => !o)}>
        <span>{cur?.label}</span><ChevronDown size={14} />
      </button>
      {open && (
        <div className="menu">
          {options.map((o) => (
            <button key={o.id} type="button" className={`menu-item ${o.id === value ? 'sel' : ''}`}
              onClick={() => { onChange(o.id); setOpen(false); }}>
              <span>{o.label}</span>{o.id === value && <Check size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Popover({ icon, active, children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useOutside(ref, () => setOpen(false));
  return (
    <div className="pop-wrap" ref={ref}>
      <button className={`icon-btn ${active || open ? 'on' : ''}`} onClick={() => setOpen((o) => !o)}>{icon}</button>
      {open && <div className="pop">{children}</div>}
    </div>
  );
}

export const StatusDot = ({ status }) => <span className={`sdot ${status}`} />;

export function PriorityIcon({ priority, size = 12 }) {
  if (priority === 'high') return <ChevronsUp size={size} className="pri high" />;
  if (priority === 'low') return <ChevronDown size={size} className="pri low" />;
  return <Equal size={size} className="pri medium" />;
}

export function Modal({ onClose, children, small }) {
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${small ? 'small' : ''}`}>{children}</div>
    </div>
  );
}

export const Toggle = ({ on, onChange }) => (
  <button type="button" className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)} aria-pressed={on} />
);

export const Segmented = ({ value, options, onChange }) => (
  <div className="seg">
    {options.map((o) => (
      <button key={o.id} type="button" className={value === o.id ? 'on' : ''} onClick={() => onChange(o.id)}>{o.label}</button>
    ))}
  </div>
);

export const Topbar = ({ title, meta, children }) => (
  <header className="topbar">
    <h1>{title}</h1>{meta && <span className="meta">{meta}</span>}
    <span className="spacer" />{children}
  </header>
);
