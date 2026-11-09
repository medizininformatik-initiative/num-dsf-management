/**
 * ApprovalHistoryList.tsx — the instance's approval requests in the approval
 * dialog: the date of the last approved request and the full history
 * ("Request #n" with date and status, the rejection reason of rejected ones,
 * newest first). The right panel only shows the most recent entries.
 * Dependencies: useApproval, ApprovalStatePill, lib/dateUtils, i18n store.
 */
import { useApprovalHistory, type ApprovalRequest } from '../../hooks/useApproval';
import { formatDateTime } from '../../lib/dateUtils';
import { useI18n } from '../../stores/i18n.store';
import { ApprovalStatePill } from '../layout/ApprovalStatusBanner';

export function ApprovalHistoryList({ instanceId }: { instanceId: string }) {
  const { t, lang } = useI18n();
  const { data } = useApprovalHistory(instanceId);
  const history: ApprovalRequest[] = Array.isArray(data) ? data : [];
  const lastApproved = history.find((h) => h.status === 'APPROVED');
  const lastApprovedAt = lastApproved?.resolved_at ?? lastApproved?.submitted_at ?? null;

  return (
    <section
      aria-label={t('approvalHistory')}
      className="mt-3 rounded-control border border-[color:var(--border)] p-3"
      data-testid="approval-history"
    >
      <p className="text-sm font-semibold text-[color:var(--text-primary)]">
        {t('approvalHistory')}
      </p>
      {lastApprovedAt && (
        <p className="mt-1 text-xs text-[color:var(--text-secondary)]">
          {t('lastApproved')}: {formatDateTime(lastApprovedAt, lang)}
        </p>
      )}
      {history.length === 0 ? (
        <p className="mt-2 text-xs text-[color:var(--text-muted)]">{t('noApprovalRequests')}</p>
      ) : (
        <ol className="mt-2 space-y-2">
          {history.map((req, i) => {
            const when = req.submitted_at ?? req.created_at;
            return (
              <li key={req.id} className="rounded-control bg-[color:var(--bg-hover)] px-3 py-2">
                <div className="flex items-center gap-3">
                  <span className="flex-1 text-sm font-medium text-[color:var(--text-primary)]">
                    {t('approvalCardRequestNum', { n: history.length - i })}
                  </span>
                  <time dateTime={when} className="text-xs text-[color:var(--text-muted)]">
                    {formatDateTime(when, lang)}
                  </time>
                  <ApprovalStatePill status={req.status} />
                </div>
                {req.status === 'REJECTED' && req.comment && (
                  <p className="mt-1 whitespace-pre-wrap break-words text-xs text-[color:var(--text-secondary)]">
                    {req.comment}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
