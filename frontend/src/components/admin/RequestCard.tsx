/**
 * RequestCard.tsx — Admin approval request card with TOTP-gated approve/reject
 * controls + expandable snapshot viewer. Extracted from pages/AdminPage.tsx
 * (project 500-line file limit). An approval is final; in certificate
 * sessions, where no TOTP step-up stands between the click and the decision,
 * Approve first asks for confirmation with a summary of what is approved.
 * Why Approve is unavailable is shown as text next to the buttons.
 *
 * Dependencies: useAdmin (approve/reject mutations), useConfirm, useI18n,
 * Button, StatusPill, Icon, TotpCodeField, fieldClasses, sonner toast.
 */
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { useApproveRequest, useRejectRequest } from '../../hooks/useAdmin';
import { useConfirm } from '../../hooks/useConfirm';
import type { ApprovalSignature } from '../../api/admin.api';
import { useI18n } from '../../stores/i18n.store';
import { getErrorMessageForStepUp } from '../../lib/getErrorMessage';
import { needsTotpStepUp } from '../../lib/authMode';
import { formatDate, relTime } from '../../lib/dateUtils';
import { Button } from '../ui/Button';
import { StatusPill } from '../ui/StatusPill';
import { Icon } from '../ui/Icon';
import { TotpCodeField } from './TotpCodeField';
import { FIELD_CLASS } from './fieldClasses';
import { parseSnapshot, type SnapshotData } from './parseSnapshot';
import { SnapshotView } from './SnapshotView';

const SILENT_CONSENT_MS = 7 * 86400_000;

interface RequestCardProps {
  request: {
    id: string;
    status: string;
    created_at?: string;
    submitted_at?: string;
    snapshot_json: string | object | null;
    signatures: ApprovalSignature[];
  };
  meEmail: string | null;
}

export type { RequestCardProps };

export function RequestCard({ request, meEmail }: RequestCardProps) {
  const { t, lang } = useI18n();
  const confirm = useConfirm();
  const titleId = useId();
  const disabledReasonId = useId();
  const commentId = useId();

  const [expanded, setExpanded] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [comment, setComment] = useState('');
  const [totpCode, setTotpCode] = useState('');

  const approveMut = useApproveRequest();
  const rejectMut = useRejectRequest();

  const snapshot = parseSnapshot(request.snapshot_json);
  const orgName = snapshot.organization?.name ?? '—';
  const orgId = snapshot.organization?.identifier ?? '—';
  const timeStr = request.submitted_at ?? request.created_at ?? '';

  const sigs = request.signatures ?? [];
  const approvals = sigs.filter((s) => s.decision === 'APPROVE');
  const meSite = meEmail ? (meEmail.split('@')[1]?.toLowerCase() ?? '') : '';
  const alreadyDecidedByMe =
    !!meEmail && sigs.some((s) => s.admin_email.toLowerCase() === meEmail.toLowerCase());
  const sameSiteApprovalExists = !!meSite && approvals.some((s) => s.admin_site === meSite);
  const busy = approveMut.isPending || rejectMut.isPending;
  const approveDisabled =
    approvals.length >= 2 || alreadyDecidedByMe || sameSiteApprovalExists || busy;
  const silentConsentDate = approvals[0]
    ? new Date(new Date(approvals[0].signed_at).getTime() + SILENT_CONSENT_MS)
    : null;
  // Why Approve is unavailable, shown as text (a title tooltip alone is not
  // reachable by keyboard or touch).
  const approveBlockedReason =
    approvals.length >= 2
      ? t('adminAlreadyApproved2')
      : alreadyDecidedByMe
        ? t('adminAlreadyDecided')
        : sameSiteApprovalExists
          ? t('adminSameSiteApproval')
          : null;

  async function handleApprove() {
    if (busy) return;
    if (needsTotpStepUp() && (!totpCode || totpCode.length !== 6)) {
      toast.error(t('adminToastTotpRequired'));
      return;
    }
    // Certificate sessions skip the TOTP step-up, which otherwise doubles as the
    // deliberate second step; ask before the final decision instead.
    if (!needsTotpStepUp()) {
      const ok = await confirm({
        title: t('adminApproveConfirmTitle'),
        message: <ApproveSummary snapshot={snapshot} firstApproval={approvals.length === 0} />,
        consequence: t('adminApproveConfirmFinal'),
        confirmLabel: t('adminApproveBtn'),
      });
      if (!ok) return;
    }
    try {
      await approveMut.mutateAsync({
        requestId: request.id,
        ...(needsTotpStepUp() ? { totpCode } : {}),
      });
      toast.success(t('adminToastApproveSuccess'));
      setTotpCode('');
    } catch (err: unknown) {
      const msg = getErrorMessageForStepUp(
        err,
        t('adminToastApproveFailed'),
        t('certStepUpFailedToast'),
      );
      toast.error(msg);
    }
  }

  async function handleReject() {
    if (busy) return;
    if (!comment.trim()) {
      toast.error(t('adminToastReasonRequired'));
      return;
    }
    if (needsTotpStepUp() && (!totpCode || totpCode.length !== 6)) {
      toast.error(t('adminToastTotpRequired'));
      return;
    }
    try {
      await rejectMut.mutateAsync({
        requestId: request.id,
        comment: comment.trim(),
        ...(needsTotpStepUp() ? { totpCode } : {}),
      });
      toast.success(t('adminToastRejectSuccess'));
      setRejecting(false);
      setComment('');
      setTotpCode('');
    } catch (err: unknown) {
      const msg = getErrorMessageForStepUp(
        err,
        t('adminToastRejectFailed'),
        t('certStepUpFailedToast'),
      );
      toast.error(msg);
    }
  }

  return (
    <article
      aria-labelledby={titleId}
      className="flex flex-col gap-4 rounded-card border border-[color:var(--border)] bg-[color:var(--bg-card)] px-5 py-5 shadow-card sm:px-6"
    >
      {/* Card header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 id={titleId} className="text-[15px] font-semibold text-[color:var(--text-primary)]">
              {orgName}
            </h2>
            <span className="rounded-md bg-[color:var(--bg-hover)] px-2 py-0.5 font-mono text-xs text-[color:var(--text-secondary)]">
              {orgId}
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <StatusPill tone="warning" icon="hourglass_top">
              {t('pending')}
            </StatusPill>
            {timeStr && (
              <span className="text-xs text-[color:var(--text-muted)]">{relTime(timeStr, t)}</span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold text-[color:var(--text-secondary)]">
              {t('adminApprovals', { n: approvals.length })}
            </span>
            {approvals.map((s) => (
              <StatusPill key={s.id} tone="success" icon="check" className="font-mono">
                {s.admin_email} <span className="opacity-80">· {s.admin_site}</span>
              </StatusPill>
            ))}
            {silentConsentDate && approvals.length === 1 && (
              <span className="text-[11px] font-semibold text-warning-fg">
                {t('adminAutoApproves', {
                  date: formatDate(silentConsentDate.toISOString(), lang),
                })}
              </span>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex shrink-0 gap-2">
          <Button
            onClick={handleApprove}
            disabled={approveDisabled}
            aria-describedby={approveBlockedReason ? disabledReasonId : undefined}
          >
            <Icon name="check" size={18} />
            {approveMut.isPending ? t('adminApprovingBtn') : t('adminApproveBtn')}
          </Button>
          {!rejecting && (
            <Button
              variant="secondary"
              className="text-danger-fg"
              onClick={() => setRejecting(true)}
              disabled={busy}
            >
              <Icon name="close" size={18} />
              {t('adminRejectBtn')}
            </Button>
          )}
        </div>
      </div>

      {approveBlockedReason && (
        <p
          id={disabledReasonId}
          className="-mt-1 flex items-center gap-1.5 text-xs text-[color:var(--text-secondary)]"
        >
          <Icon name="info" size={16} className="shrink-0" />
          {approveBlockedReason}
        </p>
      )}

      {/* Reject comment panel */}
      {rejecting && (
        <div className="flex animate-fade-in flex-col gap-2.5 rounded-xl border border-danger-border bg-danger-surface p-4">
          <label htmlFor={commentId} className="text-xs font-semibold text-danger-fg">
            {t('adminRejectionReasonLabel')}
          </label>
          <textarea
            id={commentId}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t('adminRejectionReasonPlaceholder')}
            rows={3}
            className={`${FIELD_CLASS} resize-y`}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="destructive"
              size="sm"
              onClick={handleReject}
              disabled={rejectMut.isPending}
            >
              {rejectMut.isPending ? t('adminRejectingBtn') : t('adminConfirmRejectBtn')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setRejecting(false);
                setComment('');
              }}
              disabled={rejectMut.isPending}
            >
              {t('cancel')}
            </Button>
          </div>
        </div>
      )}

      {/* TOTP confirmation input — cert-mode sessions prove possession via the
          client certificate instead, so no code is needed here. */}
      {needsTotpStepUp() && (
        <TotpCodeField
          label={t('totpCodeLabel')}
          hint={t('adminTotpRequired')}
          placeholder={t('adminTotpPlaceholder')}
          value={totpCode}
          onChange={setTotpCode}
        />
      )}

      {/* Expand toggle */}
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        className="press-effect inline-flex items-center gap-1.5 self-start rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-card)] px-2.5 py-1.5 text-xs font-medium text-[color:var(--text-secondary)] hover:bg-[color:var(--bg-hover)] hover:text-[color:var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-ring)]"
      >
        <Icon
          name="expand_more"
          size={16}
          className={`transition-transform duration-short ease-standard ${expanded ? 'rotate-180' : ''}`}
        />
        {expanded ? t('adminHideDetails') : t('adminViewDetails')}
      </button>

      {/* Snapshot viewer */}
      {expanded && (
        <div className="animate-fade-in">
          <SnapshotView snapshot={snapshot} t={t} />
        </div>
      )}
    </article>
  );
}

/** What an approval decides: the organization, its submitted data and the 4-eyes step. */
function ApproveSummary({
  snapshot,
  firstApproval,
}: {
  snapshot: SnapshotData;
  firstApproval: boolean;
}) {
  const { t, lang } = useI18n();
  const counts = [
    t('requestCardCountEndpoints', { n: snapshot.endpoints?.length ?? 0 }),
    t('requestCardCountCertificates', { n: snapshot.certificates?.length ?? 0 }),
    t('requestCardCountMemberships', { n: snapshot.memberships?.length ?? 0 }),
    t('requestCardCountContacts', { n: snapshot.contacts?.length ?? 0 }),
  ].join(' · ');
  const autoApproveDate = formatDate(new Date(Date.now() + SILENT_CONSENT_MS).toISOString(), lang);
  return (
    <div className="space-y-2">
      <p>
        <strong className="font-semibold text-[color:var(--text-primary)]">
          {snapshot.organization?.name ?? '—'}
        </strong>{' '}
        <span className="font-mono text-xs">{snapshot.organization?.identifier ?? '—'}</span>
      </p>
      <p>{counts}</p>
      <p>
        {firstApproval
          ? t('adminApproveConfirmFirst', { date: autoApproveDate })
          : t('adminApproveConfirmSecond')}
      </p>
    </div>
  );
}
