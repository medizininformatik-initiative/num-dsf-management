/**
 * EntityCard.tsx – the shared card of the entity canvas: a glass section with
 * an accent stripe, an icon + title header, an optional header slot and an add
 * Button named after the card ("+ Add Contacts"). `status` swaps the body for
 * a skeleton while loading or an error with a retry Button, so a failed
 * request never looks like "no data yet". The section (`card-<id>`) is the FK
 * jump target: tabIndex -1 lets FkLink move focus to it.
 * Dependencies: Button, Icon, Skeleton, canvas store, i18n store,
 * entity-card.css.
 */
import { useId, type CSSProperties, type ReactNode } from 'react';
import { useCanvasStore } from '../../stores/canvas.store';
import { useI18n } from '../../stores/i18n.store';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Skeleton } from '../ui/Skeleton';
import './entity-card.css';

interface EntityCardProps {
  id: string;
  title: string;
  /** Accent colour of the card (stripe and icon tile). */
  borderColor: string;
  icon: string;
  iconColor?: string;
  badge?: ReactNode;
  headerRight?: ReactNode;
  onAdd?: () => void;
  /** Visible label of the add Button; defaults to the translated "+ Add". */
  addLabel?: string;
  /** Data state of the card body. Default 'ready' renders the children. */
  status?: 'loading' | 'error' | 'ready';
  /** Retry handler for the error state (usually the query's refetch). */
  onRetry?: () => void;
  children: ReactNode;
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
  addLabel,
  status = 'ready',
  onRetry,
  children,
}: EntityCardProps) {
  const { t } = useI18n();
  const highlightedEntity = useCanvasStore((s) => s.highlightedEntity);
  const isHighlighted = highlightedEntity === id;
  const uid = useId();
  const titleId = `${uid}-title`;
  const addLabelId = `${uid}-add`;

  return (
    <section
      id={`card-${id}`}
      aria-labelledby={titleId}
      aria-busy={status === 'loading' || undefined}
      tabIndex={-1}
      className="entity-card glass hover-lift flex h-full flex-col rounded-card p-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-ring)]"
      style={
        {
          '--card-accent': borderColor,
          outline: isHighlighted ? `2px solid ${borderColor}66` : undefined,
        } as CSSProperties
      }
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className="entity-card-icon inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px]"
            style={{ color: iconColor || borderColor }}
          >
            <Icon name={icon} size={20} />
          </span>
          <h3
            id={titleId}
            className="truncate text-base font-bold leading-6 text-[color:var(--text-primary)]"
          >
            {title}
          </h3>
          {badge}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {headerRight}
          {onAdd && (
            <Button
              variant="secondary"
              size="sm"
              onClick={onAdd}
              aria-labelledby={`${addLabelId} ${titleId}`}
            >
              <span id={addLabelId}>{addLabel ?? t('add')}</span>
            </Button>
          )}
        </div>
      </div>
      {status === 'loading' && (
        <div className="min-h-[7.5rem]">
          <Skeleton lines={4} />
        </div>
      )}
      {status === 'error' && (
        <div className="flex min-h-[7.5rem] flex-col items-center justify-center gap-2.5 px-4 py-3 text-center">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-danger-border bg-danger-surface text-danger-fg">
            <Icon name="cloud_off" size={22} />
          </span>
          <p role="alert" className="text-[13px] font-medium text-[color:var(--text-secondary)]">
            {t('cardLoadError')}
          </p>
          {onRetry && (
            <Button variant="secondary" size="sm" onClick={onRetry}>
              <Icon name="refresh" size={16} />
              {t('cardRetry')}
            </Button>
          )}
        </div>
      )}
      {status === 'ready' && children}
    </section>
  );
}
