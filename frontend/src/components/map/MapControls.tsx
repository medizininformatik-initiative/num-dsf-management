/**
 * MapControls.tsx – Floating glass controls of the network map: the zoom
 * group (zoom in, zoom out, show all of Germany) and a compact, collapsible
 * legend explaining the status rings, inactive (dashed) sites, city bubbles
 * and network lines. Both float over the map canvas.
 * Dependencies: ui/Icon, lib/statusColors, mapLabels, i18n.store.
 */
import { useState } from 'react';
import { Icon } from '../ui/Icon';
import { certStatusColor } from '../../lib/statusColors';
import { useI18n } from '../../stores/i18n.store';
import { CERT_STATUSES, CERT_STATUS_LABEL_KEY } from './mapLabels';
import { ZOOM_MAX, ZOOM_MIN } from './mapGeometry';

const ICON_BUTTON =
  'press-effect flex h-9 w-9 items-center justify-center text-[color:var(--text-secondary)] transition-colors duration-short ease-standard hover:bg-[color:var(--bg-hover)] hover:text-[color:var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--focus-ring)] disabled:opacity-40 disabled:hover:bg-transparent';

interface ZoomProps {
  k: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}

export function MapZoomControls({ k, onZoomIn, onZoomOut, onReset }: ZoomProps) {
  const { t } = useI18n();
  return (
    <div
      className="glass flex flex-col overflow-hidden rounded-xl"
      role="group"
      aria-label={t('mapZoomGroup')}
    >
      <button
        type="button"
        className={ICON_BUTTON}
        onClick={onZoomIn}
        disabled={k >= ZOOM_MAX}
        aria-label={t('mapZoomIn')}
      >
        <Icon name="add" size={20} />
      </button>
      <span className="mx-2 h-px bg-[color:var(--border)]" aria-hidden="true" />
      <button
        type="button"
        className={ICON_BUTTON}
        onClick={onZoomOut}
        disabled={k <= ZOOM_MIN}
        aria-label={t('mapZoomOut')}
      >
        <Icon name="remove" size={20} />
      </button>
      <span className="mx-2 h-px bg-[color:var(--border)]" aria-hidden="true" />
      <button
        type="button"
        className={ICON_BUTTON}
        onClick={onReset}
        aria-label={t('mapZoomReset')}
      >
        <Icon name="fit_screen" size={18} />
      </button>
    </div>
  );
}

function Swatch({ color, dashed = false }: { color: string; dashed?: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className="shrink-0">
      <circle
        cx="7"
        cy="7"
        r="5.25"
        fill="var(--bg-card)"
        style={{ stroke: color }}
        strokeWidth="2"
        strokeDasharray={dashed ? '2.5 2' : undefined}
      />
    </svg>
  );
}

export function MapLegend() {
  const { t } = useI18n();
  // Open on wide screens; collapsed where the map has little room.
  const [open, setOpen] = useState(
    () =>
      typeof window.matchMedia !== 'function' || window.matchMedia('(min-width: 1024px)').matches,
  );
  return (
    <div className="glass max-w-[15rem] rounded-xl text-[11px] text-[color:var(--text-secondary)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="press-effect flex w-full items-center gap-1.5 rounded-xl px-3 py-2 font-semibold text-[color:var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--focus-ring)]"
      >
        <Icon name="legend_toggle" size={16} className="text-[color:var(--text-muted)]" />
        {t('mapLegendTitle')}
        <Icon
          name="expand_more"
          size={16}
          className={`ml-auto text-[color:var(--text-muted)] transition-transform duration-short ease-spring ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <ul className="m-0 grid animate-fade-in list-none grid-cols-2 gap-x-3 gap-y-1.5 px-3 pb-2.5 pt-0">
          {CERT_STATUSES.map((s) => (
            <li key={s} className="flex items-center gap-1.5">
              <Swatch color={certStatusColor(s)} />
              {t(CERT_STATUS_LABEL_KEY[s])}
            </li>
          ))}
          <li className="flex items-center gap-1.5">
            <Swatch color="var(--text-muted)" dashed />
            {t('mapLegendInactive')}
          </li>
          <li className="flex items-center gap-1.5">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className="shrink-0">
              <g transform="rotate(-90 7 7)" fill="none" strokeWidth="2">
                <circle cx="7" cy="7" r="5.25" style={{ stroke: certStatusColor('VALID') }} />
                <circle
                  cx="7"
                  cy="7"
                  r="5.25"
                  style={{ stroke: certStatusColor('EXPIRING') }}
                  strokeDasharray="11 22"
                />
              </g>
              <circle cx="7" cy="7" r="1.75" fill="var(--text-secondary)" />
            </svg>
            {t('mapLegendCluster')}
          </li>
          <li className="col-span-2 flex items-center gap-1.5">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className="shrink-0">
              <path d="M1 11 Q 7 1 13 11" fill="none" stroke="var(--primary)" strokeWidth="1.5" />
            </svg>
            {t('mapLegendConnection')}
          </li>
        </ul>
      )}
    </div>
  );
}
