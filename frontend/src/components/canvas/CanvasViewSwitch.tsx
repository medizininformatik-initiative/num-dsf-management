/**
 * CanvasViewSwitch.tsx – the "Simple | Detailed" segmented control above the entity cards.
 * Two toggle buttons (aria-pressed) in a labelled group, so Tab and Enter/Space operate it.
 * The choice is stored by canvasView.store and applies to all five cards.
 * Dependencies: useCanvasView, i18n store.
 */
import { useId } from 'react';
import { useCanvasView } from '../../hooks/useCanvasView';
import { useI18n } from '../../stores/i18n.store';
import type { CanvasView } from '../../stores/canvasView.store';

const OPTIONS: ReadonlyArray<{ view: CanvasView; label: 'viewSimple' | 'viewDetailed' }> = [
  { view: 'simple', label: 'viewSimple' },
  { view: 'detailed', label: 'viewDetailed' },
];

export function CanvasViewSwitch() {
  const { t } = useI18n();
  const { view, setView } = useCanvasView();
  const labelId = useId();

  return (
    <div className="mb-3 flex items-center justify-end gap-2">
      <span id={labelId} className="text-xs font-medium text-[color:var(--text-muted)]">
        {t('viewSwitchLabel')}
      </span>
      <div
        role="group"
        aria-labelledby={labelId}
        className="inline-flex rounded-full border border-[color:var(--border)] bg-[color:var(--bg-hover)] p-0.5"
      >
        {OPTIONS.map((option) => {
          const active = view === option.view;
          return (
            <button
              key={option.view}
              type="button"
              aria-pressed={active}
              onClick={() => setView(option.view)}
              className={`press-effect min-h-7 rounded-full px-3 text-xs font-semibold transition-colors duration-short ease-standard focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--focus-ring)] ${
                active
                  ? 'bg-[color:var(--bg-card)] text-[color:var(--text-primary)] shadow-sm'
                  : 'text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]'
              }`}
            >
              {t(option.label)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
