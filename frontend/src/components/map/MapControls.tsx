/**
 * MapControls.tsx – Floating glass zoom controls of the network map (zoom
 * in, zoom out, show all of Germany), floating over the map canvas. The legend
 * lives in MapLegend, below the map.
 * Dependencies: ui/Icon, i18n.store, mapGeometry.
 */
import { Icon } from '../ui/Icon';
import { useI18n } from '../../stores/i18n.store';
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
      className="glass flex flex-col overflow-hidden rounded-control"
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
        <Icon name="add" size={18} />
      </button>
      <span className="mx-2 h-px bg-[color:var(--border)]" aria-hidden="true" />
      <button
        type="button"
        className={ICON_BUTTON}
        onClick={onZoomOut}
        disabled={k <= ZOOM_MIN}
        aria-label={t('mapZoomOut')}
      >
        <Icon name="remove" size={18} />
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
