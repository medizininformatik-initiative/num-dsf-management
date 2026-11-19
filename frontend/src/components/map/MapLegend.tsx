/**
 * MapLegend.tsx – Atlas-style legend strip below the network map. Collapsed
 * by default (the choice is remembered in localStorage, which may be blocked,
 * so every access is guarded). Entries are grouped under headings that name
 * the visual element they explain: the pin ring colour (certificate status),
 * the ring style (activity), the ring segments of a city cluster, and the
 * line colour / hub / peer ring of a Verbund.
 * Dependencies: ui/Icon, lib/statusColors, mapLabels, i18n.store.
 */
import { useId, useState, type ReactNode } from 'react';
import { Icon } from '../ui/Icon';
import { certStatusColor } from '../../lib/statusColors';
import { useI18n } from '../../stores/i18n.store';
import { CERT_STATUSES, CERT_STATUS_LABEL_KEY } from './mapLabels';

export const LEGEND_STORAGE_KEY = 'dsf.map.legendOpen';

function readOpen(): boolean {
  try {
    return localStorage.getItem(LEGEND_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}
function writeOpen(open: boolean): void {
  try {
    localStorage.setItem(LEGEND_STORAGE_KEY, open ? '1' : '0');
  } catch {
    /* storage unavailable: the choice just is not remembered */
  }
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

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className="shrink-0">
      {children}
    </svg>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="min-w-[10rem]">
      <h3 className="m-0 mb-1.5 text-2xs font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">
        {title}
      </h3>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">{children}</ul>
    </section>
  );
}

function Entry({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center gap-1.5">
      {icon}
      {children}
    </li>
  );
}

export function MapLegend() {
  const { t } = useI18n();
  const [open, setOpen] = useState(readOpen);
  const panelId = useId();
  function toggle() {
    setOpen((v) => {
      writeOpen(!v);
      return !v;
    });
  }
  return (
    <div
      data-map-legend=""
      className="relative z-[2] shrink-0 border-t border-[color:var(--border)] bg-[color:var(--bg-card)] text-xs text-[color:var(--text-secondary)]"
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="press-effect flex w-full items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-[color:var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--focus-ring)]"
      >
        <Icon name="legend_toggle" size={14} className="text-[color:var(--text-muted)]" />
        {t('mapLegendTitle')}
        <Icon
          name="expand_more"
          size={14}
          className={`ml-auto text-[color:var(--text-muted)] transition-transform duration-short ease-spring ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div
          id={panelId}
          className="flex max-h-48 animate-fade-in flex-wrap gap-x-8 gap-y-3 overflow-y-auto px-4 pb-3 pt-1"
        >
          <Group title={t('mapLegendGroupCert')}>
            {CERT_STATUSES.map((s) => (
              <Entry key={s} icon={<Swatch color={certStatusColor(s)} />}>
                {t(CERT_STATUS_LABEL_KEY[s])}
              </Entry>
            ))}
          </Group>
          <Group title={t('mapLegendGroupActivity')}>
            <Entry icon={<Swatch color="var(--text-secondary)" />}>{t('mapLegendActive')}</Entry>
            <Entry icon={<Swatch color="var(--text-secondary)" dashed />}>
              {t('mapLegendInactive')}
            </Entry>
          </Group>
          <Group title={t('mapLegendGroupCluster')}>
            <Entry
              icon={
                <Glyph>
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
                </Glyph>
              }
            >
              {t('mapLegendCluster')}
            </Entry>
          </Group>
          <Group title={t('mapLegendGroupVerbund')}>
            <Entry
              icon={
                <Glyph>
                  <path
                    d="M1 11 Q 7 1 13 11"
                    fill="none"
                    stroke="var(--primary)"
                    strokeWidth="1.5"
                  />
                </Glyph>
              }
            >
              {t('mapLegendConnection')}
            </Entry>
            <Entry
              icon={
                <Glyph>
                  <rect
                    x="1"
                    y="3.5"
                    width="12"
                    height="7"
                    rx="3.5"
                    fill="none"
                    stroke="var(--text-secondary)"
                    strokeWidth="1.5"
                  />
                </Glyph>
              }
            >
              {t('mapLegendHub')}
            </Entry>
            <Entry
              icon={
                <Glyph>
                  <circle
                    cx="7"
                    cy="7"
                    r="3.5"
                    fill="none"
                    stroke="var(--text-muted)"
                    strokeWidth="1.5"
                  />
                  <circle
                    cx="7"
                    cy="7"
                    r="6"
                    fill="none"
                    stroke="var(--primary)"
                    strokeWidth="1.5"
                  />
                </Glyph>
              }
            >
              {t('mapLegendPeer')}
            </Entry>
          </Group>
        </div>
      )}
    </div>
  );
}
