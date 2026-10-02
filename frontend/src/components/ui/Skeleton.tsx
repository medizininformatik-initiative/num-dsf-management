/**
 * Skeleton.tsx – loading placeholders. Bars use the .skeleton class
 * (src/index.css): a highlight sweeps across them on the motion tokens, they
 * stay static under Reduce Motion, and their colours come from the
 * --skeleton tokens, so they follow light and dark mode. The bars are
 * decorative; screen readers get a visually hidden "Loading…" instead.
 * Dependencies: i18n store.
 */
import { useI18n } from '../../stores/i18n.store';

interface SkeletonProps {
  className?: string;
  lines?: number;
}

function barWidth(index: number) {
  if (index === 0) return 'w-3/4';
  return index % 2 === 0 ? 'w-1/2' : 'w-full';
}

export function Skeleton({ className = '', lines = 3 }: SkeletonProps) {
  const { t } = useI18n();
  return (
    <div className="space-y-3">
      <span className="sr-only">{t('loading')}</span>
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          aria-hidden="true"
          className={`skeleton h-3 rounded-full ${barWidth(i)} ${className}`}
        />
      ))}
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="rounded-[16px] border-l-4 border-[color:var(--border)] bg-[color:var(--bg-card)] p-6 entity-card-shadow">
      <div className="mb-5 flex items-center gap-3" aria-hidden="true">
        <div className="skeleton h-6 w-6 rounded-md" />
        <div className="skeleton h-4 w-28 rounded-full" />
      </div>
      <Skeleton lines={4} />
    </div>
  );
}
