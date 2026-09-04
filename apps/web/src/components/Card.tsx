import { useState, type ReactNode } from 'react';

interface Props { title: string; summary?: ReactNode; open?: boolean; children: ReactNode }

export default function Card({ title, summary, open = true, children }: Props) {
  const [isOpen, setOpen] = useState(open);
  return (
    <div className="card">
      <div className="card-head" onClick={() => setOpen((v) => !v)}>
        <span className="caret">{isOpen ? '▼' : '▶'}</span>
        <h2>{title}</h2>
        {summary != null && <span className="sum">{summary}</span>}
      </div>
      {isOpen && <div className="card-body">{children}</div>}
    </div>
  );
}
