/**
 * ApprovalStatusBanner.tsx – The latest approval request at a glance, one look
 * per state (no request, DRAFT, PENDING, APPROVED, REJECTED, WITHDRAWN): a StatusPill,
 * the date that matters (formatDateTime), the reviewer, the rejection reason
 * and, while PENDING, the four-eyes progress with the silent-consent date.
 * Shared by the right panel and the approval modal; with `onResubmit` a
 * REJECTED request offers "Fix the issues and resubmit". A change of state
 * fades the banner in again. ApprovalStatePill is the translated status label
 * for history lists (no raw enums).
 * Dependencies: StatusPill, Button, Icon, lib/dateUtils, lib/statusColors,
 * useApproval (types), i18n store.
 */
import type { ApprovalStatus, FourEyes } from '../../hooks/useApproval';
import type { TranslationKey } from '../../i18n/en';
import type { StatusTone } from '../../lib/statusColors';
import { formatDateTime } from '../../lib/dateUtils';
import { useI18n } from '../../stores/i18n.store';
import { StatusPill } from '../ui/StatusPill';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';

type BannerState = 'NONE' | 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';

interface StateLook {
  tone: StatusTone;
  icon: string;
  label: TranslationKey;
  text: TranslationKey;
  /** Tinted surface of the banner (no border, so panels never stack boxes). */
  surface: string;
}

const LOOK: Record<BannerState, StateLook> = {
  NONE: {
    tone: 'neutral',
    icon: 'draft',
    label: 'noRequest',
    text: 'approvalBannerNone',
    surface: 'bg-neutral-surface',
  },
  DRAFT: {
    tone: 'info',
    icon: 'edit_note',
    label: 'approvalStateDraft',
    text: 'approvalBannerDraft',
    surface: 'bg-info-surface',
  },
  PENDING: {
    tone: 'warning',
    icon: 'hourglass_top',
    label: 'pending',
    text: 'approvalBannerPending',
    surface: 'bg-warning-surface',
  },
  APPROVED: {
    tone: 'success',
    icon: 'verified',
    label: 'approved',
    text: 'approvalBannerApproved',
    surface: 'bg-success-surface',
  },
  REJECTED: {
    tone: 'danger',
    icon: 'block',
    label: 'rejected',
    text: 'approvalBannerRejected',
    surface: 'bg-danger-surface',
  },
  WITHDRAWN: {
    tone: 'neutral',
    icon: 'undo',
    label: 'approvalStateWithdrawn',
    text: 'approvalBannerWithdrawn',
    surface: 'bg-neutral-surface',
  },
};

const SILENT_CONSENT = 'SYSTEM:silent-consent';

function toState(status: string | null | undefined): BannerState {
  return status === 'DRAFT' ||
    status === 'PENDING' ||
    status === 'APPROVED' ||
    status === 'REJECTED' ||
    status === 'WITHDRAWN'
    ? status
    : 'NONE';
}

/** Translated, tone-coded status label of a request. */
export function ApprovalStatePill({ status }: { status: string | null | undefined }) {
  const { t } = useI18n();
  const look = LOOK[toState(status)];
  return (
    <StatusPill tone={look.tone} icon={look.icon}>
      {t(look.label)}
    </StatusPill>
  );
}

function FourEyesProgress({ fourEyes }: { fourEyes: FourEyes }) {
  const { t, lang } = useI18n();
  const total = Math.max(1, fourEyes.required);
  const approvals = Math.min(Math.max(0, fourEyes.approvals), total);
  return (
    <div className="mt-2.5">
      <div className="flex items-center gap-2">
        <div aria-hidden="true" className="flex flex-1 gap-1">
          {Array.from({ length: total }, (_, i) => (
            <span
              key={i}
              className={`h-1.5 flex-1 rounded-full transition-colors duration-medium ease-standard ${
                i < approvals ? 'bg-warning-fg' : 'bg-warning-border'
              }`}
            />
          ))}
        </div>
        <span className="text-xs font-semibold text-[color:var(--text-primary)]">
          {t('approvalBannerFourEyes', { n: approvals, total })}
        </span>
      </div>
      {fourEyes.silentConsentAt && (
        <p className="mt-1 text-xs text-[color:var(--text-secondary)]">
          {t('approvalBannerSilentConsent', {
            date: formatDateTime(fourEyes.silentConsentAt, lang),
          })}
        </p>
      )}
    </div>
  );
}

interface Props {
  approval: ApprovalStatus | null | undefined;
  /** Adds the "Fix the issues and resubmit" action to a REJECTED request. */
  onResubmit?: () => void;
  className?: string;
}

export function ApprovalStatusBanner({ approval, onResubmit, className = '' }: Props) {
  const { t, lang } = useI18n();
  const state = toState(approval?.status);
  const look = LOOK[state];

  const at = (key: TranslationKey, value: string | null | undefined) =>
    value ? t(key, { date: formatDateTime(value, lang) }) : null;
  let dateLine: string | null = null;
  if (approval && state === 'DRAFT') dateLine = at('approvalBannerCreatedAt', approval.created_at);
  if (approval && state === 'PENDING')
    dateLine = at('approvalBannerSubmittedAt', approval.submitted_at ?? approval.created_at);
  if (approval && state === 'APPROVED')
    dateLine = at('approvalBannerApprovedAt', approval.resolved_at);
  if (approval && state === 'REJECTED')
    dateLine = at('approvalBannerRejectedAt', approval.resolved_at);
  if (approval && state === 'WITHDRAWN')
    dateLine = at('approvalBannerWithdrawnAt', approval.resolved_at);

  const resolvedBy =
    (state === 'APPROVED' || state === 'REJECTED') && approval?.resolved_by
      ? approval.resolved_by
      : null;
  const reviewer =
    resolvedBy === SILENT_CONSENT
      ? t('approvalBannerSilentConsentReviewer')
      : resolvedBy
        ? t('approvalBannerReviewer', { name: resolvedBy })
        : null;

  return (
    <div
      key={state}
      data-approval-state={state}
      className={`animate-fade-in rounded-2xl p-3.5 ${look.surface} ${className}`}
    >
      <StatusPill tone={look.tone} icon={look.icon}>
        {t(look.label)}
      </StatusPill>
      <p className="mt-2 text-xs font-medium text-[color:var(--text-primary)]">{t(look.text)}</p>
      {(dateLine || reviewer) && (
        <p className="mt-1 text-xs text-[color:var(--text-secondary)]">
          {dateLine}
          {dateLine && reviewer && <br />}
          {reviewer && <span className="break-all">{reviewer}</span>}
        </p>
      )}
      {state === 'PENDING' && approval?.fourEyes && (
        <FourEyesProgress fourEyes={approval.fourEyes} />
      )}
      {state === 'REJECTED' && (
        <div className="mt-2.5">
          <p className="text-xs font-semibold text-danger-fg">{t('approvalBannerReason')}</p>
          <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-[color:var(--text-primary)]">
            {approval?.comment?.trim() || t('approvalBannerNoReason')}
          </p>
        </div>
      )}
      {state === 'REJECTED' && onResubmit && (
        <Button size="sm" className="mt-3 w-full" onClick={onResubmit}>
          <Icon name="edit_square" size={16} />
          {t('approvalBannerResubmit')}
        </Button>
      )}
    </div>
  );
}
