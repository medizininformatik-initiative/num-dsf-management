/**
 * AdminStatsSection.tsx – "Übersicht" block at the top of the admin page:
 * stat tiles for sites, requests, allow list and incidents.
 *
 * A tile is a big number, a small label and an optional secondary line.
 * The pending-requests tile scrolls to the review list when a target id is
 * given. Loading shows skeleton tiles, a failed request a single error line.
 *
 * Dependencies: useAdminStats, i18n store, dateUtils.formatDate, Icon
 */
import type { ReactNode } from 'react';
import { useAdminStats } from '../../hooks/useAdmin';
import { useI18n } from '../../stores/i18n.store';
import { formatDate } from '../../lib/dateUtils';
import { Icon } from '../ui/Icon';

interface TileProps {
  label: string;
  value: ReactNode;
  secondary?: string;
  onClick?: () => void;
}

function Tile({ label, value, secondary, onClick }: TileProps) {
  const body = (
    <>
      <div className="text-2xl font-semibold tabular-nums text-[color:var(--text-primary)]">
        {value}
      </div>
      <div className="mt-0.5 text-xs text-[color:var(--text-muted)]">{label}</div>
      {secondary && <div className="text-xs text-[color:var(--text-muted)]">{secondary}</div>}
    </>
  );
  const cls = 'surface-card block w-full p-3 text-left';
  if (!onClick) return <div className={cls}>{body}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${cls} press-effect focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-ring)]`}
    >
      {body}
    </button>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">
        {title}
      </h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{children}</div>
    </div>
  );
}

export function AdminStatsSection({ pendingTargetId }: { pendingTargetId?: string }) {
  const { t, lang } = useI18n();
  const { data, isLoading, error } = useAdminStats();

  const scrollToPending = pendingTargetId
    ? () => document.getElementById(pendingTargetId)?.scrollIntoView({ behavior: 'smooth' })
    : undefined;

  return (
    <section aria-labelledby="admin-stats-title" className="space-y-4">
      <h2
        id="admin-stats-title"
        className="text-base font-semibold text-[color:var(--text-primary)]"
      >
        {t('adminStatsTitle')}
      </h2>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-card border border-danger-border bg-danger-surface p-4 text-sm text-danger-fg"
        >
          <Icon name="error" size={20} className="shrink-0" />
          {t('adminStatsLoadFailed')}
        </div>
      )}

      {isLoading && !error && (
        <div
          role="status"
          aria-label={t('adminStatsLoading')}
          className="grid animate-pulse grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
        >
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="surface-card h-[76px]" />
          ))}
        </div>
      )}

      {data && !error && (
        <div className="space-y-4">
          <Group title={t('adminStatsSites')}>
            <Tile label={t('adminStatsSitesTotal')} value={data.sites.total} />
            <Tile
              label={t('adminStatsSitesWithLogin')}
              value={data.sites.withLoginCertificate}
              secondary={t('adminStatsOf', { n: data.sites.total })}
            />
            <Tile
              label={t('adminStatsSitesEverLoggedIn')}
              value={data.sites.everLoggedIn}
              secondary={t('adminStatsOf', { n: data.sites.total })}
            />
            <Tile label={t('adminStatsSitesToday')} value={data.sites.loggedInLast24h} />
            <Tile
              label={t('adminStatsSitesPublished')}
              value={data.sites.published}
              secondary={t('adminStatsOf', { n: data.sites.total })}
            />
          </Group>

          <Group title={t('adminStatsRequests')}>
            <Tile
              label={t('adminStatsRequestsPending')}
              value={data.requests.pending}
              onClick={scrollToPending}
            />
            <Tile label={t('adminStatsRequestsApproved')} value={data.requests.approved} />
            <Tile label={t('adminStatsRequestsRejected')} value={data.requests.rejected} />
            <Tile label={t('adminStatsRequestsWithdrawn')} value={data.requests.withdrawn} />
            <Tile label={t('adminStatsRequestsToday')} value={data.requests.approvedLast24h} />
          </Group>

          <Group title={t('adminStatsAllowList')}>
            <Tile
              label={t('adminStatsVersion')}
              value={data.allowList.currentVersion ?? '–'}
              secondary={
                data.allowList.currentPublishedAt
                  ? formatDate(data.allowList.currentPublishedAt, lang)
                  : t('adminStatsVersionNone')
              }
            />
            <Tile
              label={t('adminStatsUpToDate')}
              value={data.allowList.sitesUpToDate}
              secondary={t('adminStatsOf', { n: data.sites.total })}
            />
            <Tile label={t('adminStatsNeverFetched')} value={data.allowList.sitesNeverFetched} />
          </Group>

          <Group title={t('adminStatsIncidents')}>
            <Tile label={t('adminStatsIncidentsOpen')} value={data.incidents.open} />
          </Group>
        </div>
      )}
    </section>
  );
}
