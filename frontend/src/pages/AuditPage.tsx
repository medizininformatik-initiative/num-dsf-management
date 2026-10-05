/**
 * AuditPage.tsx – Cross-instance audit log view
 * Shows events across ALL instances the user has access to (admin = all).
 * Dependencies: useCrossInstanceAudit, useI18n
 */
import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useCrossInstanceAudit } from '../hooks/useAudit';
import { useMe } from '../hooks/useMe';
import { useI18n } from '../stores/i18n.store';
import type { TranslationKey } from '../i18n/en';
import { Button } from '../components/ui/Button';
import { AdminPageHeader } from '../components/admin/AdminPageHeader';
import { StatusPill } from '../components/ui/StatusPill';
import { formatDateTime } from '../lib/dateUtils';
import type { StatusTone } from '../lib/statusColors';

const OPERATION: Record<string, { tone: StatusTone; label: TranslationKey }> = {
  CREATE: { tone: 'success', label: 'shellOpCreate' },
  UPDATE: { tone: 'info', label: 'shellOpUpdate' },
  DELETE: { tone: 'danger', label: 'shellOpDelete' },
  APPROVE: { tone: 'success', label: 'shellOpApprove' },
  REJECT: { tone: 'warning', label: 'shellOpReject' },
  LOGIN: { tone: 'info', label: 'shellOpLogin' },
  LOGOUT: { tone: 'neutral', label: 'shellOpLogout' },
  OTP_REQUEST: { tone: 'neutral', label: 'shellOpOtpRequest' },
  OTP_VERIFY: { tone: 'info', label: 'shellOpOtpVerify' },
  TOTP_SETUP: { tone: 'info', label: 'shellOpTotpSetup' },
  TOTP_VERIFY: { tone: 'info', label: 'shellOpTotpVerify' },
  FAILED_LOGIN: { tone: 'danger', label: 'shellOpFailedLogin' },
};

const RESOURCE: Record<string, TranslationKey> = {
  ORGANIZATION: 'shellEntityOrganization',
  CONTACT: 'shellEntityContact',
  ENDPOINT: 'shellEntityEndpoint',
  CERTIFICATE: 'shellEntityCertificate',
  MEMBERSHIP: 'shellEntityMembership',
  AUTH: 'shellEntityAuth',
  APPROVAL: 'shellEntityApproval',
  MARKETPLACE: 'shellEntityMarketplace',
};

const TH = 'px-3 py-2.5 text-left text-[12px] font-bold text-[color:var(--text-secondary)]';
const TD = 'px-3 py-2.5 text-[color:var(--text-primary)]';

export function AuditPage() {
  const { t, lang } = useI18n();
  const { data: me } = useMe();
  const [page, setPage] = useState(1);
  const limit = 50;
  // Only query once admin is confirmed: a non-admin would otherwise fetch and
  // briefly render audit rows before the me-based redirect below resolves.
  const { data, isLoading, error } = useCrossInstanceAudit(page, limit, me?.isAdmin === true);
  const rows = data?.data ?? [];
  const total = data?.meta.total ?? 0;
  const isAdmin = !!data?.meta.isAdmin;
  const totalPages = Math.max(Math.ceil(total / limit), 1);

  // When the dataset shrinks the current page can fall past the last page,
  // querying an empty page; clamp back into [1, totalPages].
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  if (me && !me.isAdmin) return <Navigate to="/app" replace />;

  return (
    <div className="flex-1 overflow-y-auto font-sans">
      <AdminPageHeader
        icon="history"
        title={t('auditLog')}
        subtitle={isAdmin ? t('auditScopeAdmin') : t('auditScopeOwner')}
      />
      <div className="p-6 sm:p-8">
        {isLoading && <p className="text-sm text-[color:var(--text-muted)]">{t('loading')}</p>}
        {error && (
          <p role="alert" className="text-sm text-danger-fg">
            {t('auditLoadFailed')}
          </p>
        )}

        {!isLoading && !error && rows.length === 0 && (
          <p className="text-sm text-[color:var(--text-muted)]">{t('auditEmpty')}</p>
        )}

        {rows.length > 0 && (
          <div className="glass-thin overflow-x-auto rounded-2xl">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="bg-[color:var(--bg-hover)]">
                  <th className={TH}>{t('auditColTimestamp')}</th>
                  <th className={TH}>{t('auditColInstance')}</th>
                  <th className={TH}>{t('auditColUser')}</th>
                  <th className={TH}>{t('auditColResource')}</th>
                  <th className={TH}>{t('auditColOperation')}</th>
                  <th className={TH}>{t('auditColIp')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const op = OPERATION[r.operation];
                  const resourceKey = RESOURCE[r.resource_type];
                  return (
                    <tr key={r.id} className="border-t border-[color:var(--border)]">
                      <td className={`${TD} whitespace-nowrap`}>
                        {formatDateTime(r.timestamp, lang)}
                      </td>
                      <td className={TD}>
                        {r.organization_name ??
                          r.instance_label ??
                          (r.instance_id ? r.instance_id.slice(0, 8) : '—')}
                        {r.organization_identifier && (
                          <div className="font-mono text-[11px] text-[color:var(--text-muted)]">
                            {r.organization_identifier}
                          </div>
                        )}
                      </td>
                      <td className={`${TD} font-mono`}>{r.user_email ?? '—'}</td>
                      <td className={TD}>{resourceKey ? t(resourceKey) : r.resource_type}</td>
                      <td className="px-3 py-2.5">
                        <StatusPill tone={op?.tone ?? 'neutral'} className="capitalize">
                          {op ? t(op.label) : r.operation}
                        </StatusPill>
                      </td>
                      <td className={`${TD} font-mono text-[color:var(--text-muted)]`}>
                        {r.ip_address ?? '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-end gap-3 text-[12px]">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page === 1}
            >
              {t('prev')}
            </Button>
            <span className="text-[color:var(--text-secondary)]">
              {t('paginationShowing', { page, total: totalPages })}
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage(Math.min(totalPages, page + 1))}
              disabled={page === totalPages}
            >
              {t('next')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
