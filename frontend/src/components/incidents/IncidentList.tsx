/**
 * IncidentList.tsx – the incidents the caller may see, in the backend's order
 * (open first, then newest): title, status, escalation level, suspension,
 * affected site, report date and a "Your report" mark. Each row is a button
 * that selects the incident; the selected row carries aria-current. Loading,
 * error and empty states follow the admin panels.
 * Dependencies: IncidentPills, Skeleton, Icon, lib/dateUtils, i18n store.
 */
import type { CSSProperties } from 'react';
import type { Incident } from '../../api/incidents.api';
import { formatDate } from '../../lib/dateUtils';
import { useI18n } from '../../stores/i18n.store';
import { Icon } from '../ui/Icon';
import { Skeleton } from '../ui/Skeleton';
import { IncidentPills } from './IncidentPills';

interface IncidentListProps {
  incidents: Incident[];
  isLoading: boolean;
  isError: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function IncidentList({
  incidents,
  isLoading,
  isError,
  selectedId,
  onSelect,
}: IncidentListProps) {
  const { t, lang } = useI18n();

  if (isError) {
    return (
      <p
        role="alert"
        className="flex items-start gap-3 rounded-card border border-danger-border bg-danger-surface p-4 text-sm text-danger-fg"
      >
        <Icon name="error" size={20} className="shrink-0" />
        {t('incidentsLoadFailed')}
      </p>
    );
  }
  if (isLoading) {
    return (
      <div className="surface-card p-5">
        <Skeleton lines={3} />
      </div>
    );
  }
  if (incidents.length === 0) {
    return (
      <p className="surface-card flex items-center gap-2 p-5 text-sm text-[color:var(--text-muted)]">
        <Icon name="check_circle" size={16} className="shrink-0 text-success-fg" />
        {t('incidentsEmpty')}
      </p>
    );
  }

  return (
    <ul aria-label={t('incidentsListAria')} className="space-y-2" data-testid="incident-list">
      {incidents.map((incident, i) => {
        const selected = incident.id === selectedId;
        return (
          <li
            key={incident.id}
            style={{ '--stagger-index': i } as CSSProperties}
            className="animate-list-item-in"
          >
            <button
              type="button"
              onClick={() => onSelect(incident.id)}
              aria-current={selected || undefined}
              className={`press-effect surface-card block w-full p-4 text-left transition-colors duration-short ease-standard focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-ring)] ${
                selected
                  ? 'border-[color:var(--accent)] bg-[color:var(--accent-surface)]'
                  : 'hover:border-[color:var(--border-strong)]'
              }`}
            >
              <span className="block break-words text-sm font-semibold text-[color:var(--text-primary)]">
                {incident.title}
              </span>
              <span className="mt-2 block">
                <IncidentPills incident={incident} />
              </span>
              <span className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[color:var(--text-muted)]">
                <span>{incident.organization?.name ?? t('incidentSiteUnknownShort')}</span>
                <span aria-hidden="true">·</span>
                <span>
                  {t('incidentReportedOn', { date: formatDate(incident.reportedAt, lang) })}
                </span>
                {incident.isMine && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-medium text-[color:var(--text-secondary)]">
                      {t('incidentMineBadge')}
                    </span>
                  </>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
