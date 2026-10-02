/**
 * StatusPill.tsx – compact status label in one of the shared tones (success,
 * warning, danger, info, neutral): tinted surface, hairline border and
 * 700-tone text that keeps WCAG AA contrast in light and dark mode. Optional
 * leading icon (decorative; the text carries the meaning).
 * Dependencies: TONE_CLASS (src/lib/statusColors.ts), Icon, .pill (index.css).
 */
import type { HTMLAttributes } from 'react';
import { TONE_CLASS, type StatusTone } from '../../lib/statusColors';
import { Icon } from './Icon';

export interface StatusPillProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: StatusTone;
  /** Material Symbols name shown before the label, e.g. "check_circle". */
  icon?: string;
}

export function StatusPill({
  tone = 'neutral',
  icon,
  className = '',
  children,
  ...rest
}: StatusPillProps) {
  return (
    <span {...rest} className={`pill ${TONE_CLASS[tone]} ${className}`}>
      {icon && <Icon name={icon} size={14} />}
      {children}
    </span>
  );
}
