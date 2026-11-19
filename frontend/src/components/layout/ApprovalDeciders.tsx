/**
 * ApprovalDeciders.tsx – "Approved by a@x, b@y" / "Rejected by …" line for a
 * resolved approval request, from the individual admin decisions (falls back
 * to resolved_by when none are listed, e.g. older requests).
 * Dependencies: useApproval (types), i18n store.
 */
import type { ApprovalRequest } from '../../hooks/useApproval';
import { useI18n } from '../../stores/i18n.store';

const SYSTEM_PREFIX = 'SYSTEM:';

export function ApprovalDeciders({
  req,
  className = '',
}: {
  req: ApprovalRequest;
  className?: string;
}) {
  const { t } = useI18n();
  if (req.status !== 'APPROVED' && req.status !== 'REJECTED') return null;
  const wanted = req.status === 'APPROVED' ? 'APPROVE' : 'REJECT';
  let names = (req.decisions ?? []).filter((d) => d.decision === wanted).map((d) => d.admin_email);
  if (names.length === 0 && req.resolved_by && !req.resolved_by.startsWith(SYSTEM_PREFIX)) {
    names = [req.resolved_by];
  }
  if (names.length === 0) return null;
  const key = req.status === 'APPROVED' ? 'approvalDecidedApprovedBy' : 'approvalDecidedRejectedBy';
  return (
    <p
      data-testid="approval-deciders"
      className={`break-words text-xs text-[color:var(--text-secondary)] ${className}`}
    >
      {t(key, { names: names.join(', ') })}
    </p>
  );
}
