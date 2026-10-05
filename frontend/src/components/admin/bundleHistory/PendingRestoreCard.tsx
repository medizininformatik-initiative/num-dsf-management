/**
 * PendingRestoreCard.tsx – the restore request waiting for a second admin.
 * Shows version, reason, requester and age. The requester can only cancel;
 * everybody else can approve (unless from the requester's site, then the
 * reason is shown as text) or reject. The actual decision runs in
 * RestoreDecisionDialog. Dependencies: Icon, StatusPill, Button, dateUtils,
 * i18n store.
 */
import { useId } from 'react';
import { Icon } from '../../ui/Icon';
import { StatusPill } from '../../ui/StatusPill';
import { Button } from '../../ui/Button';
import { relTime } from '../../../lib/dateUtils';
import { useI18n } from '../../../stores/i18n.store';
import type { BundleRestoreRequest } from '../../../api/bundleVersions.api';

export type RestoreDecisionKind = 'approve' | 'reject' | 'cancel';

const siteOf = (email: string) => (email.split('@')[1] || '').toLowerCase();

interface Props {
  request: BundleRestoreRequest;
  meEmail: string | null;
  onAction: (kind: RestoreDecisionKind) => void;
}

export function PendingRestoreCard({ request, meEmail, onAction }: Props) {
  const { t } = useI18n();
  const hintId = useId();
  const mine = meEmail != null && request.requestedBy.toLowerCase() === meEmail.toLowerCase();
  const sameSite = meEmail != null && siteOf(meEmail) === siteOf(request.requestedBy);
  const canApprove = !mine && !sameSite;

  return (
    <section
      aria-labelledby={`${hintId}-title`}
      data-testid="pending-restore"
      className="glass-thin mb-6 rounded-2xl p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2
              id={`${hintId}-title`}
              className="text-base font-semibold text-[color:var(--text-primary)]"
            >
              {t('bundleRestorePendingTitle')}
            </h2>
            <StatusPill tone="warning" icon="hourglass_top">
              {t('pending')}
            </StatusPill>
          </div>
          <p className="mt-1 text-sm text-[color:var(--text-secondary)]">
            {t('bundleRestorePendingBody', {
              n: request.sourceVersionNumber ?? '?',
              who: request.requestedBy,
              when: relTime(request.requestedAt, t),
            })}
          </p>
          <p className="mt-1 text-sm text-[color:var(--text-primary)]">
            <span className="font-semibold">{t('historyRestoreReason')}: </span>
            {request.reason}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {mine ? (
            <Button size="sm" variant="secondary" onClick={() => onAction('cancel')}>
              {t('bundleRestoreCancel')}
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                disabled={!canApprove}
                aria-describedby={!canApprove ? hintId : undefined}
                onClick={() => onAction('approve')}
              >
                <Icon name="check" size={16} />
                {t('bundleRestoreApprove')}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="text-danger-fg"
                onClick={() => onAction('reject')}
              >
                <Icon name="close" size={16} />
                {t('bundleRestoreReject')}
              </Button>
            </>
          )}
        </div>
      </div>
      {(mine || !canApprove) && (
        <p
          id={hintId}
          className="mt-2 flex items-center gap-1.5 text-xs text-[color:var(--text-secondary)]"
        >
          <Icon name="info" size={16} className="shrink-0" />
          {mine ? t('bundleRestoreOwnHint') : t('adminPromotionsSameSiteHint')}
        </p>
      )}
    </section>
  );
}
