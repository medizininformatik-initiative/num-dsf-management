/**
 * StatusPage.tsx – Instance status overview for site admins
 * Dependencies: canvas.store, useOrganization, useContacts, useEndpoints,
 *               useCertificates, useMemberships, useApproval, dateUtils, i18n.store
 */
import { useCanvasStore } from '../stores/canvas.store';
import { useOrganization } from '../hooks/useOrganization';
import { useContacts } from '../hooks/useContacts';
import { useEndpoints } from '../hooks/useEndpoints';
import { useCertificates } from '../hooks/useCertificates';
import { useMemberships } from '../hooks/useMemberships';
import { useApprovalStatus, useApprovalHistory } from '../hooks/useApproval';
import { daysUntil } from '../lib/dateUtils';
import { useI18n } from '../stores/i18n.store';
import { Icon } from '../components/ui/Icon';
import { StatusPill } from '../components/ui/StatusPill';
import type { StatusTone } from '../lib/statusColors';

const CARD = 'glass-thin rounded-2xl p-4';

const STATUS_TONE: Record<string, StatusTone> = {
  APPROVED: 'success',
  PENDING: 'warning',
  REJECTED: 'danger',
  DRAFT: 'neutral',
};
const STATUS_LABEL = {
  APPROVED: 'approvalStatusApproved',
  PENDING: 'approvalStatusPending',
  REJECTED: 'approvalStatusRejected',
  DRAFT: 'approvalStateDraft',
} as const;

function StatCard({
  icon,
  label,
  value,
  detail,
}: {
  icon: string;
  label: string;
  value: string | number;
  detail?: string;
}) {
  return (
    <div className={`${CARD} min-w-[140px] flex-1`}>
      <div className="mb-2 flex items-center gap-2">
        <Icon name={icon} size={20} className="text-[color:var(--primary)]" />
        <span className="text-[12px] font-semibold text-[color:var(--text-secondary)]">
          {label}
        </span>
      </div>
      <p className="m-0 text-2xl font-bold text-[color:var(--text-primary)]">{value}</p>
      {detail && <p className="mt-1 text-[11px] text-[color:var(--text-muted)]">{detail}</p>}
    </div>
  );
}

interface ApprovalHistoryRow {
  id: string;
  status: string;
  submitted_at?: string | null;
  created_at: string;
}

interface CertRow {
  valid_until: string;
}

export function StatusPage() {
  const { t } = useI18n();
  const activeInstanceId = useCanvasStore((s) => s.activeInstanceId);
  const { data: org } = useOrganization(activeInstanceId);
  const { data: contacts = [] } = useContacts(activeInstanceId);
  const { data: endpoints = [] } = useEndpoints(activeInstanceId);
  const { data: certs = [] } = useCertificates(activeInstanceId);
  const { data: memberships = [] } = useMemberships(activeInstanceId);
  const { data: approval } = useApprovalStatus(activeInstanceId);
  const { data: history = [] } = useApprovalHistory(activeInstanceId);

  const lastApproved = history.find((h: ApprovalHistoryRow) => h.status === 'APPROVED');
  const nextExpiry =
    certs.length > 0 ? Math.min(...certs.map((c: CertRow) => daysUntil(c.valid_until))) : null;

  const tone = (status?: string): StatusTone => STATUS_TONE[status ?? ''] ?? 'neutral';
  const label = (status?: string) => {
    const key = STATUS_LABEL[(status ?? '') as keyof typeof STATUS_LABEL];
    return key ? t(key) : (status ?? t('statusNoRequest'));
  };
  const expiryTone: StatusTone = nextExpiry !== null && nextExpiry < 30 ? 'danger' : 'warning';

  return (
    <div className="flex-1 overflow-y-auto p-8 font-sans">
      <div className="mb-6">
        <h1 className="mb-1 text-xl font-bold text-[color:var(--text-primary)]">
          {org?.name || t('instanceOverview')}
        </h1>
        <p className="m-0 text-[12px] text-[color:var(--text-muted)]">
          {org?.identifier || t('noOrgConfigured')}
        </p>
      </div>

      <div className="mb-6 flex flex-wrap gap-3">
        <StatCard icon="contact_phone" label={t('contacts')} value={contacts.length} />
        <StatCard icon="hub" label={t('endpoints')} value={endpoints.length} />
        <StatCard
          icon="verified_user"
          label={t('certificates')}
          value={certs.length}
          detail={nextExpiry !== null ? `${t('nextExpiry')}: ${nextExpiry}d` : undefined}
        />
        <StatCard icon="groups" label={t('memberships')} value={memberships.length} />
      </div>

      <div className={`${CARD} mb-4 p-5`}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="m-0 text-sm font-bold text-[color:var(--text-primary)]">
            {t('approvalStatus')}
          </h2>
          <StatusPill tone={tone(approval?.status)}>{label(approval?.status)}</StatusPill>
        </div>
        {lastApproved && (
          <p className="m-0 text-[12px] text-[color:var(--text-muted)]">
            {t('lastApproved')}:{' '}
            {new Date(lastApproved.resolved_at || lastApproved.submitted_at).toLocaleDateString(
              'de-DE',
            )}
          </p>
        )}
      </div>

      {nextExpiry !== null && nextExpiry < 90 && (
        <div
          role="status"
          className={`mb-4 flex items-center gap-3 rounded-2xl border p-4 ${
            expiryTone === 'danger'
              ? 'border-danger-border bg-danger-surface text-danger-fg'
              : 'border-warning-border bg-warning-surface text-warning-fg'
          }`}
        >
          <Icon name="warning" size={20} />
          <div>
            <p className="m-0 text-[13px] font-bold">
              {t('certExpiresIn')} {nextExpiry} {t('statusDaysSuffix')}
            </p>
            <p className="mt-0.5 text-[12px]">{t('renewButtonHint')}</p>
          </div>
        </div>
      )}

      <div className={`${CARD} p-5`}>
        <h2 className="mb-3 text-sm font-bold text-[color:var(--text-primary)]">
          {t('approvalHistory')}
        </h2>
        {history.length === 0 ? (
          <p className="text-[12px] text-[color:var(--text-muted)]">{t('noApprovalRequests')}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {history.slice(0, 10).map((req: ApprovalHistoryRow, i: number) => (
              <li
                key={req.id}
                className="flex items-center gap-3 rounded-lg bg-[color:var(--bg-hover)] p-2"
              >
                <span className="flex-1 text-[12px] font-semibold text-[color:var(--text-primary)]">
                  {t('approvalCardRequestNum', { n: history.length - i })}
                </span>
                <span className="text-[11px] text-[color:var(--text-muted)]">
                  {new Date(req.submitted_at || req.created_at).toLocaleDateString('de-DE')}
                </span>
                <StatusPill tone={tone(req.status)}>{label(req.status)}</StatusPill>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
