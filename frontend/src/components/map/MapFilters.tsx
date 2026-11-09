/**
 * MapFilters.tsx – Floating glass toolbar of the network map: search (with a
 * clear button), an activity segmented control whose thumb slides between
 * All / Active / Inactive, certificate-status toggle chips in the shared
 * tones, the visible-count summary (announced politely), and a second row
 * with the network (Verbund) pills and the "show all connections" toggle.
 * An optional leading slot holds the organization-list toggle.
 * Dependencies: react, network.api types, i18n.store, lib/statusColors,
 * mapLabels, ui/Icon, map.css.
 */
import type { ReactNode } from 'react';
import type { MapOrganization } from '../../api/network.api';
import { useI18n } from '../../stores/i18n.store';
import { CERT_STATUS_TONE, TONE_CLASS, certStatusColor } from '../../lib/statusColors';
import { CERT_STATUSES, CERT_STATUS_LABEL_KEY } from './mapLabels';
import { Icon } from '../ui/Icon';

export interface MapFilterState {
  query: string;
  activeMode: 'all' | 'active' | 'inactive';
  certStatuses: Set<MapOrganization['cert_status']>;
}

interface Props {
  state: MapFilterState;
  onChange: (next: MapFilterState) => void;
  totalCount: number;
  visibleCount: number;
  cityCount: number;
  showAllEdges: boolean;
  onToggleShowAllEdges: () => void;
  verbundPills: ReactNode; // <VerbundPills … /> instance, owned by parent
  /** Rendered first in the toolbar, e.g. the organization-list toggle. */
  leading?: ReactNode;
}

const MODES = ['all', 'active', 'inactive'] as const;
const MODE_LABEL_KEY: Record<
  (typeof MODES)[number],
  'mapFilterAll' | 'mapFilterActive' | 'mapFilterInactive'
> = {
  all: 'mapFilterAll',
  active: 'mapFilterActive',
  inactive: 'mapFilterInactive',
};

const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-ring)]';
const CHIP = `press-effect inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors duration-short ease-standard ${FOCUS}`;
const CHIP_OFF =
  'border-[color:var(--border)] bg-transparent text-[color:var(--text-secondary)] hover:bg-[color:var(--bg-hover)] hover:text-[color:var(--text-primary)]';

export function MapFilters({
  state,
  onChange,
  totalCount,
  visibleCount,
  cityCount,
  showAllEdges,
  onToggleShowAllEdges,
  verbundPills,
  leading,
}: Props) {
  const { t } = useI18n();
  function toggleStatus(s: MapOrganization['cert_status']) {
    const next = new Set(state.certStatuses);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    onChange({ ...state, certStatuses: next });
  }
  const modeIndex = MODES.indexOf(state.activeMode);

  return (
    <div className="glass flex flex-col gap-2 rounded-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        {leading}

        <div className="relative w-full min-w-[12rem] sm:w-64">
          <Icon
            name="search"
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)]"
          />
          <input
            type="search"
            value={state.query}
            onChange={(e) => onChange({ ...state, query: e.target.value })}
            placeholder={t('mapFilterSearchPlaceholder')}
            aria-label={t('mapSearchLabel')}
            className={`h-9 w-full rounded-control border border-[color:var(--border-strong)] bg-[color:var(--bg-input)] pl-9 pr-9 text-sm text-[color:var(--text-primary)] placeholder:text-[color:var(--text-muted)] focus:border-[color:var(--focus-ring)] focus:outline-none focus:ring-[3px] focus:ring-primary/20 dark:focus:ring-brand-400/30 [&::-webkit-search-cancel-button]:hidden`}
          />
          {state.query && (
            <button
              type="button"
              onClick={() => onChange({ ...state, query: '' })}
              aria-label={t('mapClearSearch')}
              className={`press-effect absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 animate-fade-in items-center justify-center rounded-control text-[color:var(--text-muted)] hover:bg-[color:var(--bg-hover)] hover:text-[color:var(--text-primary)] ${FOCUS}`}
            >
              <Icon name="close" size={16} />
            </button>
          )}
        </div>

        <div
          role="group"
          aria-label={t('mapFilterActivityLabel')}
          className="relative grid h-9 grid-cols-3 rounded-control bg-[color:var(--bg-hover)] p-0.5"
        >
          <span
            aria-hidden="true"
            className="map-segment-thumb absolute inset-y-0.5 left-0.5 rounded-small bg-[color:var(--bg-card)] shadow-sm"
            style={{
              width: 'calc((100% - 4px) / 3)',
              transform: `translateX(${modeIndex * 100}%)`,
            }}
          />
          {MODES.map((mode) => {
            const on = state.activeMode === mode;
            return (
              <button
                key={mode}
                type="button"
                aria-pressed={on}
                onClick={() => onChange({ ...state, activeMode: mode })}
                className={`relative z-[1] rounded-small px-3 text-xs font-semibold capitalize transition-colors duration-short ease-standard ${FOCUS} ${on ? 'text-[color:var(--text-primary)]' : 'text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]'}`}
              >
                {t(MODE_LABEL_KEY[mode])}
              </button>
            );
          })}
        </div>

        <div
          role="group"
          aria-label={t('mapFilterStatusLabel')}
          className="flex flex-wrap items-center gap-1.5"
        >
          {CERT_STATUSES.map((s) => {
            const on = state.certStatuses.has(s);
            return (
              <button
                key={s}
                type="button"
                aria-pressed={on}
                onClick={() => toggleStatus(s)}
                className={`${CHIP} ${on ? TONE_CLASS[CERT_STATUS_TONE[s]] : CHIP_OFF}`}
              >
                <span
                  aria-hidden="true"
                  className="h-2 w-2 rounded-full transition-opacity duration-short"
                  style={{ background: certStatusColor(s), opacity: on ? 1 : 0.45 }}
                />
                {t(CERT_STATUS_LABEL_KEY[s])}
              </button>
            );
          })}
        </div>

        <p className="m-0 ml-auto text-xs text-[color:var(--text-secondary)]" aria-live="polite">
          {t('mapFilterShowingOfCities', {
            visible: visibleCount,
            total: totalCount,
            cities: cityCount,
          })}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {verbundPills}
        <button
          type="button"
          aria-pressed={showAllEdges}
          onClick={onToggleShowAllEdges}
          className={`${CHIP} ml-auto ${showAllEdges ? 'border-[color:var(--primary)] bg-[color:color-mix(in_srgb,var(--primary)_12%,transparent)] text-[color:var(--text-primary)]' : CHIP_OFF}`}
        >
          <Icon name="polyline" size={14} />
          {t('mapShowAllEdges')}
        </button>
      </div>
    </div>
  );
}
