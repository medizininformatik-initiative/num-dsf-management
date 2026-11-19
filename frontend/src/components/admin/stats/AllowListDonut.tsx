/**
 * AllowListDonut.tsx – donut ring of sites on the current allow list version
 * (stroke-dasharray animates from 0) with the count in the middle and free
 * content (version, date, ...) beside it.
 * Dependencies: lib/useCountUp, CountUp
 */
import type { ReactNode } from 'react';
import { useGrowIn } from '../../../lib/useCountUp';
import { CountUp } from './CountUp';

const R = 40;
const CIRC = 2 * Math.PI * R;

interface Props {
  value: number;
  total: number;
  ofLabel: string;
  ariaLabel: string;
  children?: ReactNode;
}

export function AllowListDonut({ value, total, ofLabel, ariaLabel, children }: Props) {
  const ready = useGrowIn();
  const ratio = total > 0 ? Math.min(1, value / total) : 0;
  const len = ratio * CIRC;
  return (
    <div className="flex items-center gap-5">
      <div role="img" aria-label={ariaLabel} className="relative h-28 w-28 shrink-0">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden="true">
          <circle cx="50" cy="50" r={R} fill="none" strokeWidth="10" stroke="var(--skeleton)" />
          <circle
            cx="50"
            cy="50"
            r={R}
            fill="none"
            strokeWidth="10"
            strokeLinecap="round"
            stroke="var(--accent)"
            strokeDasharray={`${ready ? len : 0} ${CIRC}`}
            style={{ transition: 'stroke-dasharray 800ms cubic-bezier(.2,.8,.2,1)' }}
          />
        </svg>
        <div
          aria-hidden="true"
          className="absolute inset-0 flex flex-col items-center justify-center"
        >
          <span className="text-2xl font-semibold leading-none text-[color:var(--text-primary)]">
            <CountUp value={value} />
          </span>
          <span className="mt-1 text-xs text-[color:var(--text-muted)]">{ofLabel}</span>
        </div>
      </div>
      <div className="min-w-0 space-y-2 text-sm">{children}</div>
    </div>
  );
}
