/**
 * RequestsBar.tsx – one stacked bar over the request states (pending,
 * approved, rejected, withdrawn) with a legend; a segment with `onClick`
 * renders its legend item as a button.
 * Dependencies: lib/useCountUp, CountUp
 */
import { useGrowIn } from '../../../lib/useCountUp';
import { CountUp } from './CountUp';

export interface RequestSegment {
  key: string;
  label: string;
  value: number;
  color: string;
  onClick?: () => void;
}

const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-ring)]';

export function RequestsBar({ segments }: { segments: RequestSegment[] }) {
  const ready = useGrowIn();
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const summary = segments.map((s) => `${s.label}: ${s.value}`).join(', ');

  return (
    <div className="space-y-3">
      <div
        role="img"
        aria-label={summary}
        className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-[color:var(--skeleton)]"
      >
        {segments
          .filter((s) => s.value > 0)
          .map((s, i) => (
            <div
              key={s.key}
              className="h-full"
              style={{
                width: ready ? `${(s.value / total) * 100}%` : '0%',
                backgroundColor: s.color,
                transition: 'width 700ms cubic-bezier(.2,.8,.2,1)',
                transitionDelay: `${i * 80}ms`,
              }}
            />
          ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
        {segments.map((s) => {
          const body = (
            <>
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: s.color }}
              />
              <span className="text-[color:var(--text-secondary)]">{s.label}</span>
              <span className="font-semibold text-[color:var(--text-primary)]">
                <CountUp value={s.value} />
              </span>
            </>
          );
          return (
            <li key={s.key}>
              {s.onClick ? (
                <button
                  type="button"
                  onClick={s.onClick}
                  className={`press-effect inline-flex items-center gap-1.5 rounded ${FOCUS}`}
                >
                  {body}
                </button>
              ) : (
                <span className="inline-flex items-center gap-1.5">{body}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
