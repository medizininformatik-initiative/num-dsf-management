/**
 * FunnelBars.tsx – onboarding funnel: one thin bar per step, each relative to
 * the total, growing in from 0 with a small stagger.
 * Dependencies: lib/useCountUp, CountUp
 */
import { useGrowIn } from '../../../lib/useCountUp';
import { CountUp } from './CountUp';

export interface FunnelRow {
  label: string;
  value: number;
}

function percentOf(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

export function FunnelBars({ rows, total }: { rows: FunnelRow[]; total: number }) {
  const ready = useGrowIn();
  return (
    <div className="space-y-2.5">
      {rows.map((row, i) => {
        const pct = percentOf(row.value, total);
        return (
          <div
            key={row.label}
            role="img"
            aria-label={`${row.label}: ${row.value} (${pct}%)`}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-sm"
          >
            <span aria-hidden="true" className="truncate text-[color:var(--text-secondary)]">
              {row.label}
            </span>
            <span aria-hidden="true" className="text-right text-[color:var(--text-primary)]">
              <span className="font-semibold">
                <CountUp value={row.value} />
              </span>
              <span className="ml-1.5 text-xs tabular-nums text-[color:var(--text-muted)]">
                {pct}%
              </span>
            </span>
            <div
              aria-hidden="true"
              className="col-span-2 h-2 overflow-hidden rounded-full bg-[color:var(--skeleton)]"
            >
              <div
                className="h-full rounded-full bg-[color:var(--accent)]"
                style={{
                  width: ready ? `${pct}%` : '0%',
                  transition: 'width 700ms cubic-bezier(.2,.8,.2,1)',
                  transitionDelay: `${i * 80}ms`,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
