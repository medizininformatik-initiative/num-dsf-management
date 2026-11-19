/**
 * AdminStatsSection.tsx – "Übersicht" block at the top of the admin page:
 * small animated plots for sites (onboarding funnel), requests (stacked bar),
 * allow list (donut) and incidents (count tile).
 *
 * Numbers count up and bars grow in on mount; under reduced motion the final
 * state shows at once. The pending legend item scrolls to the review list when
 * a target id is given. Loading shows a skeleton; a failed request shows one
 * error line, or a non-blocking note above the charts when data is already
 * loaded (a failed background refetch keeps the last data on screen).
 *
 * Dependencies: useAdminStats, lib/motion, i18n store, dateUtils.formatDate, Icon, stats/*
 */
import { scrollIntoViewSafe } from '../../lib/motion';
import { useAdminStats } from '../../hooks/useAdmin';
import { useI18n } from '../../stores/i18n.store';
import { formatDate } from '../../lib/dateUtils';
import { Icon } from '../ui/Icon';
import { AllowListDonut } from './stats/AllowListDonut';
import { CountUp } from './stats/CountUp';
import { FunnelBars } from './stats/FunnelBars';
import { RequestsBar } from './stats/RequestsBar';
import { StatPanel } from './stats/StatPanel';

const CAPTION = 'text-xs text-[color:var(--text-muted)]';

export function AdminStatsSection({ pendingTargetId }: { pendingTargetId?: string }) {
  const { t, lang } = useI18n();
  const { data, isLoading, error } = useAdminStats();

  const scrollToPending = pendingTargetId
    ? () => scrollIntoViewSafe(document.getElementById(pendingTargetId))
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

      {isLoading && !data && !error && (
        <div
          role="status"
          aria-label={t('adminStatsLoading')}
          className="grid animate-pulse gap-4 lg:grid-cols-2"
        >
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="surface-card h-[140px]" />
          ))}
        </div>
      )}

      {data && (
        <div className="grid gap-4 lg:grid-cols-2">
          <StatPanel title={t('adminStatsSites')}>
            <FunnelBars
              total={data.sites.total}
              rows={[
                { label: t('adminStatsSitesTotal'), value: data.sites.total },
                { label: t('adminStatsSitesWithLogin'), value: data.sites.withLoginCertificate },
                { label: t('adminStatsSitesEverLoggedIn'), value: data.sites.everLoggedIn },
                { label: t('adminStatsSitesPublished'), value: data.sites.published },
              ]}
            />
            <p className={CAPTION}>
              {`${t('adminStatsSitesToday')}: ${data.sites.loggedInLast24h}`}
            </p>
          </StatPanel>

          <StatPanel title={t('adminStatsRequests')}>
            <RequestsBar
              segments={[
                {
                  key: 'pending',
                  label: t('adminStatsRequestsPending'),
                  value: data.requests.pending,
                  color: 'var(--accent)',
                  onClick: scrollToPending,
                },
                {
                  key: 'approved',
                  label: t('adminStatsRequestsApproved'),
                  value: data.requests.approved,
                  color: 'var(--tone-success-fg)',
                },
                {
                  key: 'rejected',
                  label: t('adminStatsRequestsRejected'),
                  value: data.requests.rejected,
                  color: 'var(--tone-danger-fg)',
                },
                {
                  key: 'withdrawn',
                  label: t('adminStatsRequestsWithdrawn'),
                  value: data.requests.withdrawn,
                  color: 'var(--text-muted)',
                },
              ]}
            />
            <p className={CAPTION}>
              {`${t('adminStatsRequestsToday')}: ${data.requests.approvedLast24h}`}
            </p>
          </StatPanel>

          <StatPanel title={t('adminStatsAllowList')}>
            <AllowListDonut
              value={data.allowList.sitesUpToDate}
              total={data.sites.total}
              ofLabel={t('adminStatsOf', { n: data.sites.total })}
              ariaLabel={`${t('adminStatsUpToDate')}: ${data.allowList.sitesUpToDate} ${t('adminStatsOf', { n: data.sites.total })}`}
            >
              <div>
                <div className={CAPTION}>{t('adminStatsVersion')}</div>
                <div className="text-lg font-semibold tabular-nums text-[color:var(--text-primary)]">
                  {data.allowList.currentVersion ?? '–'}
                </div>
                <div className={CAPTION}>
                  {data.allowList.currentPublishedAt
                    ? formatDate(data.allowList.currentPublishedAt, lang)
                    : t('adminStatsVersionNone')}
                </div>
              </div>
              <div className="flex items-center gap-1.5 text-[color:var(--text-secondary)]">
                <span
                  aria-hidden="true"
                  className="h-2 w-2 shrink-0 rounded-full bg-[color:var(--accent)]"
                />
                {t('adminStatsUpToDate')}
              </div>
              <div className={CAPTION}>
                {`${t('adminStatsNeverFetched')}: ${data.allowList.sitesNeverFetched}`}
              </div>
            </AllowListDonut>
          </StatPanel>

          <StatPanel
            title={t('adminStatsIncidents')}
            className={data.incidents.open > 0 ? '!border-danger-border !bg-danger-surface' : ''}
          >
            <div
              className={`text-3xl font-semibold ${
                data.incidents.open > 0 ? 'text-danger-fg' : 'text-[color:var(--text-primary)]'
              }`}
            >
              <CountUp value={data.incidents.open} />
            </div>
            <div className={CAPTION}>{t('adminStatsIncidentsOpen')}</div>
          </StatPanel>
        </div>
      )}
    </section>
  );
}
