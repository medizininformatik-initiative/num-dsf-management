/**
 * ApprovalRunningRequest.tsx — the "Running request" view of the approval
 * dialog: a PENDING request at a glance. When it was submitted (absolute and
 * relative) and by whom, what it contains (entity counts of its snapshot) and
 * the four-eyes progress with the silent-consent date (ApprovalStatusBanner).
 * Display only; the dialog owns the withdraw action.
 * Dependencies: ApprovalStatusBanner, admin/parseSnapshot, lib/dateUtils,
 * useApproval (types), i18n store.
 */
import type { ApprovalStatus } from '../../hooks/useApproval';
import { formatDateTime, relTime } from '../../lib/dateUtils';
import { useI18n } from '../../stores/i18n.store';
import { parseSnapshot } from '../admin/parseSnapshot';
import { ApprovalStatusBanner } from '../layout/ApprovalStatusBanner';

export function ApprovalRunningRequest({ approval }: { approval: ApprovalStatus }) {
  const { t, lang } = useI18n();
  const when = approval.submitted_at ?? approval.created_at;
  const snapshot = parseSnapshot(approval.snapshot_json);
  const counts = [
    { label: t('contacts'), n: snapshot.contacts?.length },
    { label: t('endpoints'), n: snapshot.endpoints?.length },
    { label: t('certificates'), n: snapshot.certificates?.length },
    { label: t('memberships'), n: snapshot.memberships?.length },
  ];
  const hasSnapshot = counts.some((c) => c.n !== undefined);

  return (
    <div className="space-y-3" data-testid="approval-running-request">
      <ApprovalStatusBanner approval={approval} />

      <dl className="rounded-control border border-[color:var(--border)] px-4 py-2 text-xs">
        <div className="flex items-center justify-between gap-3 border-b border-[color:var(--border)] py-1.5">
          <dt className="font-medium text-[color:var(--text-muted)]">
            {t('approvalRunningSubmitted')}
          </dt>
          <dd className="text-right font-semibold text-[color:var(--text-primary)]">
            <time dateTime={when}>{formatDateTime(when, lang)}</time>
            <span className="ml-2 font-normal text-[color:var(--text-secondary)]">
              ({relTime(when, t)})
            </span>
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3 py-1.5">
          <dt className="font-medium text-[color:var(--text-muted)]">
            {t('approvalRunningSubmittedBy')}
          </dt>
          <dd className="break-all text-right font-semibold text-[color:var(--text-primary)]">
            {approval.submitted_by || '—'}
          </dd>
        </div>
      </dl>

      <div className="rounded-control border border-[color:var(--border)] px-4 py-3">
        <p className="mb-2 text-xs font-bold text-[color:var(--text-primary)]">
          {t('approvalRunningContents')}
        </p>
        {hasSnapshot ? (
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
            {counts.map((c) => (
              <li key={c.label} className="flex flex-col-reverse">
                <span className="text-[color:var(--text-muted)]">{c.label}</span>
                <span className="text-lg font-semibold tabular-nums text-[color:var(--text-primary)]">
                  {c.n ?? 0}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-[color:var(--text-muted)]">{t('approvalRunningNoSnapshot')}</p>
        )}
      </div>
    </div>
  );
}
