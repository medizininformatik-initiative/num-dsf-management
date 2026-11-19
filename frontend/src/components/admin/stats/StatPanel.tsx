/**
 * StatPanel.tsx – titled card around one chart group of the admin overview.
 * Dependencies: none
 */
import type { ReactNode } from 'react';

interface Props {
  title: string;
  children: ReactNode;
  className?: string;
}

export function StatPanel({ title, children, className = '' }: Props) {
  return (
    <div className={`surface-card space-y-3 p-4 ${className}`}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">
        {title}
      </h3>
      {children}
    </div>
  );
}
