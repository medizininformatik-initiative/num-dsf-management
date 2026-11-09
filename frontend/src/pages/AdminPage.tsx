/**
 * AdminPage.tsx – Admin review page for pending approval requests.
 *
 * Thin page container. The per-request card with TOTP-gated approve/reject
 * and snapshot viewer lives in components/admin/RequestCard.tsx. The sticky
 * glass header carries the help link; request cards enter staggered and the
 * loading spinner uses animate-spin (it keeps turning under Reduce Motion, as
 * a busy indicator should).
 *
 * Dependencies: useAdmin/useMe hooks, RequestCard, AdminPageHeader, Icon.
 */
import type { CSSProperties } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { usePendingApprovals } from '../hooks/useAdmin';
import { useMe } from '../hooks/useMe';
import { useI18n } from '../stores/i18n.store';
import { RequestCard, type RequestCardProps } from '../components/admin/RequestCard';
import { AdminPageHeader } from '../components/admin/AdminPageHeader';
import { Icon } from '../components/ui/Icon';

export function AdminPage() {
  const { t } = useI18n();
  const { data: requests, isLoading, error } = usePendingApprovals();
  const { data: me } = useMe();

  const is403 = (error as { response?: { status?: number } } | null)?.response?.status === 403;

  if (me && !me.isAdmin) return <Navigate to="/app" replace />;

  return (
    <div className="flex-1 overflow-y-auto">
      <AdminPageHeader
        title={t('adminPageTitle')}
        subtitle={t('adminPageSubtitle')}
        actions={
          <Link
            to="/app/admin/help"
            className="press-effect inline-flex min-h-8 items-center gap-1.5 rounded-control px-3 text-xs font-semibold text-primary hover:bg-[color:var(--bg-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-ring)] dark:text-brand-400"
          >
            <Icon name="help" size={14} />
            {t('adminHelpLink')}
          </Link>
        }
      />

      <div className="space-y-4 px-6 py-6 sm:px-8">
        <div className="flex gap-3 rounded-card border border-info-border bg-info-surface p-4 text-sm text-info-fg">
          <Icon name="shield" size={20} className="shrink-0" />
          <div className="space-y-0.5">
            <p className="font-semibold">{t('adminFourEyesTitle')}</p>
            <p>{t('adminFourEyesBody')}</p>
          </div>
        </div>

        {/* Error state */}
        {error && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-card border border-danger-border bg-danger-surface p-4 text-sm text-danger-fg"
          >
            <Icon name="error" size={20} className="shrink-0" />
            {is403 ? t('adminAccessDenied') : t('adminLoadFailed')}
          </div>
        )}

        {/* Loading state */}
        {isLoading && !error && (
          <div
            role="status"
            className="flex items-center justify-center gap-2.5 py-10 text-sm text-[color:var(--text-muted)]"
          >
            <Icon name="progress_activity" size={20} className="animate-spin" />
            {t('adminLoadingRequests')}
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !error && requests && requests.length === 0 && (
          <div className="surface-card flex animate-fade-in flex-col items-center justify-center gap-3 px-5 py-12 text-center">
            <Icon name="check_circle" size={40} className="text-success-fg" />
            <div>
              <div className="text-base font-semibold text-[color:var(--text-primary)]">
                {t('adminNoPendingTitle')}
              </div>
              <div className="mt-1 text-sm text-[color:var(--text-muted)]">
                {t('adminNoPendingBody')}
              </div>
            </div>
          </div>
        )}

        {/* Request cards */}
        {!isLoading && !error && requests && requests.length > 0 && (
          <div className="flex flex-col gap-4">
            <div className="text-xs text-[color:var(--text-muted)]">
              {requests.length === 1
                ? t('adminPendingCount', { n: requests.length })
                : t('adminPendingCountPlural', { n: requests.length })}
            </div>
            <ul className="flex flex-col gap-4">
              {requests.map((req: RequestCardProps['request'], i) => (
                <li
                  key={req.id}
                  className="animate-list-item-in"
                  style={{ '--stagger-index': i } as CSSProperties}
                >
                  <RequestCard request={req} meEmail={me?.email ?? null} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
