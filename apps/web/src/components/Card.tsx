import { useState, type ReactNode } from 'react';

interface Props { title: string; summary?: ReactNode; help?: ReactNode; open?: boolean; children: ReactNode }

/** Small circled "?" that reveals an explanation on hover or keyboard focus. */
export function Help({ children }: { children: ReactNode }) {
  return (
    <span className="help" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="help-btn" aria-label="What is this?">?</button>
      <span className="help-tip" role="tooltip">{children}</span>
    </span>
  );
}

export default function Card({ title, summary, help, open = true, children }: Props) {
  const [isOpen, setOpen] = useState(open);
  return (
    <div className="card">
      <div className="card-head" onClick={() => setOpen((v) => !v)}>
        <span className="caret">{isOpen ? '▼' : '▶'}</span>
        <h2>{title}</h2>
        {summary != null && <span className="sum">{summary}</span>}
        {help != null && <Help>{help}</Help>}
      </div>
      {isOpen && <div className="card-body">{children}</div>}
    </div>
  );
}

/** Progressive disclosure: a quiet link-style toggle that reveals the less-used controls. */
export function Disclosure({ label, openLabel, children, defaultOpen = false }: { label: string; openLabel?: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="disclosure">
      <button type="button" className="disclosure-btn" onClick={() => setOpen((v) => !v)}>
        <span className="caret">{open ? '▼' : '▶'}</span>{open ? (openLabel ?? label) : label}
      </button>
      {open && <div className="disclosure-body">{children}</div>}
    </div>
  );
}
