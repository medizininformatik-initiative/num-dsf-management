/**
 * EntityCard.tsx – Shared wrapper, styled per Stitch code.html. `status`
 * swaps the body for a skeleton while loading or an error with a retry, so a
 * failed request never looks like "no data yet".
 */
import React from 'react';
import { useCanvasStore } from '../../stores/canvas.store';
import { useI18n } from '../../stores/i18n.store';
import { Skeleton } from '../ui/Skeleton';

interface EntityCardProps {
  id: string;
  title: string;
  borderColor: string;
  icon: string;
  iconColor?: string;
  badge?: React.ReactNode;
  headerRight?: React.ReactNode;
  onAdd?: () => void;
  addLabel?: string;
  /** Data state of the card body. Default 'ready' renders the children. */
  status?: 'loading' | 'error' | 'ready';
  /** Retry handler for the error state (usually the query's refetch). */
  onRetry?: () => void;
  children: React.ReactNode;
}

export function EntityCard({
  id,
  title,
  borderColor,
  icon,
  iconColor,
  badge,
  headerRight,
  onAdd,
  addLabel = '+ Add',
  status = 'ready',
  onRetry,
  children,
}: EntityCardProps) {
  const { t } = useI18n();
  const highlightedEntity = useCanvasStore((s) => s.highlightedEntity);
  const isHighlighted = highlightedEntity === id;

  return (
    <div
      id={`card-${id}`}
      className="rounded-[16px] p-6 entity-card-shadow group transition-all duration-300 hover:-translate-y-1"
      style={{
        background: 'var(--bg-card)',
        borderLeft: `4px solid ${borderColor}`,
        outline: isHighlighted ? `2px solid ${borderColor}66` : 'none',
        outlineOffset: '2px',
        transition: 'outline 0.3s ease, transform 0.3s ease',
      }}
    >
      <div className="flex justify-between items-start mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span
              className="material-symbols-outlined text-[20px]"
              style={{ color: iconColor || borderColor }}
            >
              {icon}
            </span>
            <h3 className="font-bold" style={{ color: 'var(--text-primary)' }}>
              {title}
            </h3>
            {badge}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {headerRight}
          {onAdd && (
            <button
              onClick={onAdd}
              className="text-[10px] font-bold px-2 py-1 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition-colors"
            >
              {addLabel}
            </button>
          )}
        </div>
      </div>
      {status === 'loading' && (
        <div aria-busy="true">
          <Skeleton lines={3} />
        </div>
      )}
      {status === 'error' && (
        <div role="alert" className="flex items-center justify-between gap-3 text-xs">
          <span style={{ color: 'var(--text-secondary)' }}>{t('cardLoadError')}</span>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="font-bold px-2 py-1 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
            >
              {t('cardRetry')}
            </button>
          )}
        </div>
      )}
      {status === 'ready' && children}
    </div>
  );
}
