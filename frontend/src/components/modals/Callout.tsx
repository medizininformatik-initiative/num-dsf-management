/**
 * Callout.tsx — a short note inside a form: tinted tone surface with a
 * hairline border, a leading icon and an optional title. The title takes the
 * tone colour; the body stays in the secondary text colour so longer text is
 * comfortable to read. Both keep AA contrast in light and dark mode.
 * Dependencies: Icon, StatusTone (lib/statusColors).
 */
import type { ReactNode } from 'react';
import type { StatusTone } from '../../lib/statusColors';
import { Icon } from '../ui/Icon';

const SURFACE: Record<StatusTone, string> = {
  success: 'bg-success-surface border-success-border',
  warning: 'bg-warning-surface border-warning-border',
  danger: 'bg-danger-surface border-danger-border',
  info: 'bg-info-surface border-info-border',
  neutral: 'bg-neutral-surface border-neutral-border',
};

const ACCENT: Record<StatusTone, string> = {
  success: 'text-success-fg',
  warning: 'text-warning-fg',
  danger: 'text-danger-fg',
  info: 'text-info-fg',
  neutral: 'text-neutral-fg',
};

interface CalloutProps {
  tone: StatusTone;
  icon: string;
  title?: ReactNode;
  children?: ReactNode;
  /** role="alert" for blocking problems that appear while the user works. */
  role?: 'alert' | 'status';
  className?: string;
}

export function Callout({ tone, icon, title, children, role, className = '' }: CalloutProps) {
  return (
    <div
      role={role}
      className={`flex gap-3 rounded-control border p-3 ${SURFACE[tone]} ${className}`}
    >
      <Icon name={icon} size={20} className={`mt-px shrink-0 ${ACCENT[tone]}`} />
      <div className="min-w-0 space-y-1 text-xs leading-relaxed text-[color:var(--text-secondary)]">
        {title && <p className={`font-semibold ${ACCENT[tone]}`}>{title}</p>}
        {children}
      </div>
    </div>
  );
}
