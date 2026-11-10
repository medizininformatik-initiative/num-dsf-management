/**
 * IncidentDetail.tsx – one incident as everyone who may see it sees it: title
 * with status, level and suspension pills, the facts (site, reported, detected,
 * confirmed, closed; the reporter only when the API returns it), the
 * description only when the API returns it (admins and the reporter), the
 * Zulip thread link, the NIS2/DPO panel and the timeline with the chain
 * status. Admin pages pass `renderAdmin` to add the actions and edit forms
 * between the facts and the timeline. Unknown or hidden incidents (404) get a
 * plain notice.
 * Dependencies: useIncident, IncidentPills, Nis2Panel, IncidentTimeline,
 * lib/dateUtils, Skeleton, Icon, i18n store.
 */
import { useId, type ReactNode } from 'react';
import type { IncidentDetail as IncidentDetailData } from '../../api/incidents.api';
import { useIncident } from '../../hooks/useIncidents';
import { formatDateTime } from '../../lib/dateUtils';
import { useI18n } from '../../stores/i18n.store';
import { Icon } from '../ui/Icon';
import { Skeleton } from '../ui/Skeleton';
import { IncidentPills } from './IncidentPills';
import { IncidentTimeline } from './IncidentTimeline';
import { Nis2Panel } from './Nis2Panel';

interface IncidentDetailProps {
  id: string;
  renderAdmin?: (detail: IncidentDetailData) => ReactNode;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold text-[color:var(--text-secondary)]">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-[color:var(--text-primary)]">{children}</dd>
    </div>
  );
}

export function IncidentDetail({ id, renderAdmin }: IncidentDetailProps) {
  const { t, lang } = useI18n();
  const titleId = useId();
  const { data, isLoading, isError } = useIncident(id);

  if (isLoading) {
    return (
      <div className="surface-card p-5">
        <Skeleton lines={5} />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <p
        role="alert"
        className="surface-card flex items-start gap-3 p-5 text-sm text-[color:var(--text-secondary)]"
      >
        <Icon name="search_off" size={20} className="shrink-0 text-[color:var(--text-muted)]" />
        {t('incidentNotFound')}
      </p>
    );
  }

  const { incident, events, chain } = data;
  const byOn = (at: string, by: string | null) =>
    by ? t('incidentDetailByOn', { date: formatDateTime(at, lang), by }) : formatDateTime(at, lang);

  return (
    <article aria-labelledby={titleId} className="space-y-4" data-testid="incident-detail">
      <section className="surface-card p-5">
        <h2
          id={titleId}
          className="break-words text-lg font-bold leading-tight text-[color:var(--text-primary)]"
        >
          {incident.title}
        </h2>
        <div className="mt-2">
          <IncidentPills incident={incident} />
        </div>

        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <Fact label={t('incidentDetailSite')}>
            {incident.organization
              ? `${incident.organization.name} (${incident.organization.identifier})`
              : t('incidentSiteUnknownShort')}
          </Fact>
          <Fact label={t('incidentDetailReportedAt')}>
            {byOn(
              incident.reportedAt,
              incident.reportedByOrganization
                ? t('incidentReporterOrgCert', { org: incident.reportedByOrganization })
                : incident.reportedBy,
            )}
          </Fact>
          <Fact label={t('incidentDetailDetectedAt')}>
            {formatDateTime(incident.detectedAt, lang)}
          </Fact>
          {incident.confirmedAt && (
            <Fact label={t('incidentDetailConfirmed')}>
              {byOn(incident.confirmedAt, incident.confirmedBy)}
            </Fact>
          )}
          {incident.closedAt && (
            <Fact label={t('incidentDetailClosed')}>
              {byOn(incident.closedAt, incident.closedBy)}
            </Fact>
          )}
          {incident.zulipUrl && (
            <Fact label={t('incidentDetailZulip')}>
              <a
                href={incident.zulipUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 break-all font-medium text-[color:var(--accent)] underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-ring)]"
              >
                {incident.zulipUrl}
                <Icon name="open_in_new" size={14} className="shrink-0" />
              </a>
            </Fact>
          )}
        </dl>

        {incident.description !== null && (
          <div className="mt-4 border-t border-[color:var(--border)] pt-4">
            <h3 className="text-xs font-semibold text-[color:var(--text-secondary)]">
              {t('incidentDetailDescription')}
            </h3>
            <p className="mt-0.5 text-2xs text-[color:var(--text-muted)]">
              {t('incidentDetailDescriptionHint')}
            </p>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm text-[color:var(--text-primary)]">
              {incident.description}
            </p>
          </div>
        )}
      </section>

      {renderAdmin?.(data)}

      <Nis2Panel incident={incident} />
      <IncidentTimeline events={events} chain={chain} />
    </article>
  );
}
