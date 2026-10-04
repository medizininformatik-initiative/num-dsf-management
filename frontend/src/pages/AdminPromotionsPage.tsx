/**
 * AdminPromotionsPage.tsx – /app/admin/promotions
 * Pending 4-eyes admin promotion requests. A second admin from a different
 * site approves or rejects. The requester can cancel. Every decision is
 * confirmed in the step-up dialog (foundation Modal; TOTP code in OTP
 * sessions); why Approve is unavailable is shown as text.
 * Dependencies: adminPromotionsApi, useI18n, useMe, useToastMutation,
 * AdminPageHeader, StepUpConfirmDialog, Button, StatusPill, Icon, Skeleton,
 * fieldClasses, lib/getErrorMessage, lib/dateUtils, tanstack-query, sonner
 */
import { useId, useState, type CSSProperties } from 'react';
import { Navigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { adminPromotionsApi, type PromotionRequest } from '../api/admin.api';
import { useI18n } from '../stores/i18n.store';
import type { TranslationKey } from '../i18n/en';
import { useMe } from '../hooks/useMe';
import { getErrorMessageForStepUp } from '../lib/getErrorMessage';
import { relTime } from '../lib/dateUtils';
import { useToastMutation } from '../hooks/useToastMutation';
import { AdminPageHeader } from '../components/admin/AdminPageHeader';
import { StepUpConfirmDialog } from '../components/admin/StepUpConfirmDialog';
import { FIELD_CLASS, LABEL_CLASS } from '../components/admin/fieldClasses';
import { Button } from '../components/ui/Button';
import { StatusPill } from '../components/ui/StatusPill';
import { Icon } from '../components/ui/Icon';
import { Skeleton } from '../components/ui/Skeleton';

type ActionKind = 'approve' | 'reject' | 'cancel';

const TITLE_KEY: Record<ActionKind, TranslationKey> = {
  approve: 'adminPromotionsConfirmApprove',
  reject: 'adminPromotionsConfirmReject',
  cancel: 'adminPromotionsConfirmCancel',
};

const BODY_KEY: Record<ActionKind, TranslationKey> = {
  approve: 'adminPromotionsConfirmBody_approve',
  reject: 'adminPromotionsConfirmBody_reject',
  cancel: 'adminPromotionsConfirmBody_cancel',
};

const CONFIRM_KEY: Record<ActionKind, TranslationKey> = {
  approve: 'adminPromotionsApprove',
  reject: 'adminPromotionsReject',
  cancel: 'adminPromotionsWithdrawBtn',
};

function siteOf(email: string): string {
  return (email.split('@')[1] || '').toLowerCase();
}

export function AdminPromotionsPage() {
  const { t } = useI18n();
  const reasonId = useId();

  const { data: me } = useMe();
  const qc = useQueryClient();

  const { data: requests, isLoading } = useQuery({
    queryKey: ['admin', 'promotions'],
    queryFn: adminPromotionsApi.list,
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  const [pending, setPending] = useState<{ kind: ActionKind; req: PromotionRequest } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [reason, setReason] = useState('');

  const mutApprove = useMutation({
    mutationFn: (vars: { id: string; totpCode?: string }) =>
      adminPromotionsApi.approve(vars.id, vars.totpCode),
    onSuccess: () => {
      toast.success(t('promotionApprovedToast'));
      qc.invalidateQueries({ queryKey: ['admin', 'promotions'] });
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (err: unknown) => {
      const msg = getErrorMessageForStepUp(
        err,
        t('genericActionFailed'),
        t('certStepUpFailedToast'),
      );
      toast.error(msg);
    },
  });

  const mutReject = useToastMutation({
    mutationFn: (vars: { id: string; reason: string; totpCode?: string }) =>
      adminPromotionsApi.reject(vars.id, vars.reason, vars.totpCode),
    successMessage: t('promotionRejectedToast'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'promotions'] }),
    errorFallback: t('genericActionFailed'),
  });

  const mutCancel = useToastMutation({
    mutationFn: (vars: { id: string; totpCode?: string }) =>
      adminPromotionsApi.cancel(vars.id, vars.totpCode),
    successMessage: t('promotionCancelledToast'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'promotions'] }),
    errorFallback: t('genericActionFailed'),
  });

  if (me && !me.isAdmin) return <Navigate to="/app" replace />;

  // The confirm button fires a single-use TOTP-guarded mutation; gate it on the
  // matching mutation's pending state so a double-click can't consume the code
  // twice (the second call 401s on the already-spent code).
  const confirmPending =
    (pending?.kind === 'approve' && mutApprove.isPending) ||
    (pending?.kind === 'reject' && mutReject.isPending) ||
    (pending?.kind === 'cancel' && mutCancel.isPending);

  function close() {
    setPending(null);
    setTotpCode('');
    setReason('');
  }

  function open(kind: ActionKind, req: PromotionRequest) {
    setTotpCode('');
    setReason('');
    setPending({ kind, req });
  }

  function execute(code: string | undefined) {
    if (!pending) return;
    const totpField = code !== undefined ? { totpCode: code } : {};
    // Success closes the dialog; a failure keeps it open for a fresh code.
    const settle = { onSuccess: close, onError: () => setTotpCode('') };
    if (pending.kind === 'approve') {
      mutApprove.mutate({ id: pending.req.id, ...totpField }, settle);
    } else if (pending.kind === 'reject') {
      if (!reason.trim()) {
        toast.error(t('adminPromotionsRejectReasonRequired'));
        return;
      }
      mutReject.mutate({ id: pending.req.id, reason: reason.trim(), ...totpField }, settle);
    } else if (pending.kind === 'cancel') {
      mutCancel.mutate({ id: pending.req.id, ...totpField }, settle);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <AdminPageHeader
        icon="verified_user"
        title={t('adminPromotionsTitle')}
        subtitle={t('adminPromotionsSubtitle')}
      />

      <div className="mx-auto max-w-5xl space-y-5 px-6 py-6 sm:px-8">
        <div className="flex gap-3 rounded-xl border border-info-border bg-info-surface p-4 text-info-fg">
          <Icon name="shield" size={22} className="mt-px shrink-0" />
          <div className="text-[13px] leading-5">
            <p className="font-semibold">{t('adminPromotionsRule')}</p>
            <p>{t('adminPromotionsRuleHint')}</p>
          </div>
        </div>

        {isLoading && (
          <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-card)] p-5">
            <Skeleton lines={3} />
          </div>
        )}
        {!isLoading && requests && requests.length === 0 && (
          <p className="flex items-center gap-2 rounded-xl border border-dashed border-[color:var(--border)] p-4 text-sm text-[color:var(--text-muted)]">
            <Icon name="check_circle" size={20} className="text-success-fg" />
            {t('adminPromotionsEmpty')}
          </p>
        )}

        {requests && requests.length > 0 && (
          <ul className="flex flex-col gap-3">
            {requests.map((req, i) => (
              <PromotionItem
                key={req.id}
                req={req}
                index={i}
                meEmail={me?.email ?? null}
                onAction={(kind) => open(kind, req)}
              />
            ))}
          </ul>
        )}
      </div>

      <StepUpConfirmDialog
        open={pending !== null}
        title={pending ? t(TITLE_KEY[pending.kind]) : ''}
        subtitle={pending?.req.target_email}
        message={pending ? t(BODY_KEY[pending.kind]) : undefined}
        confirmLabel={pending ? t(CONFIRM_KEY[pending.kind]) : t('confirm')}
        destructive={pending?.kind === 'reject' || pending?.kind === 'cancel'}
        pending={confirmPending}
        confirmDisabled={pending?.kind === 'reject' && !reason.trim()}
        isDirty={pending?.kind === 'reject' && reason.trim() !== ''}
        totpCode={totpCode}
        onTotpCodeChange={setTotpCode}
        onConfirm={execute}
        onCancel={close}
      >
        {pending?.kind === 'reject' && (
          <div>
            <label htmlFor={reasonId} className={LABEL_CLASS}>
              {t('adminPromotionsRejectReasonLabel')}
            </label>
            <textarea
              id={reasonId}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('adminPromotionsRejectReasonPlaceholder')}
              rows={3}
              required
              className={`${FIELD_CLASS} resize-y`}
            />
          </div>
        )}
      </StepUpConfirmDialog>
    </div>
  );
}

function PromotionItem({
  req,
  index,
  meEmail,
  onAction,
}: {
  req: PromotionRequest;
  index: number;
  meEmail: string | null;
  onAction: (kind: ActionKind) => void;
}) {
  const { t } = useI18n();
  const reasonId = useId();
  const isMyRequest = meEmail != null && req.requested_by.toLowerCase() === meEmail.toLowerCase();
  const sameSiteAsRequester = meEmail != null && siteOf(meEmail) === siteOf(req.requested_by);
  const canApprove = !isMyRequest && !sameSiteAsRequester;

  return (
    <li
      style={{ '--stagger-index': index } as CSSProperties}
      className="animate-list-item-in rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-card)] px-5 py-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="break-all text-sm font-bold text-[color:var(--text-primary)]">
              {req.target_email}
            </span>
            {req.status === 'PENDING' && (
              <StatusPill tone="warning" icon="hourglass_top">
                {t('pending')}
              </StatusPill>
            )}
          </div>
          <div className="mt-1 text-xs text-[color:var(--text-muted)]">
            {t('adminPromotionsRequestedBy')}: <span className="font-mono">{req.requested_by}</span>
            {' · '}
            <span>{relTime(req.requested_at, t)}</span>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {isMyRequest ? (
            <Button size="sm" variant="secondary" onClick={() => onAction('cancel')}>
              {t('adminPromotionsCancel')}
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                disabled={!canApprove}
                aria-describedby={!canApprove ? reasonId : undefined}
                onClick={() => onAction('approve')}
              >
                <Icon name="check" size={16} />
                {t('adminPromotionsApprove')}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="text-danger-fg"
                onClick={() => onAction('reject')}
              >
                <Icon name="close" size={16} />
                {t('adminPromotionsReject')}
              </Button>
            </>
          )}
        </div>
      </div>
      {!isMyRequest && !canApprove && (
        <p
          id={reasonId}
          className="mt-2 flex items-center gap-1.5 text-xs text-[color:var(--text-secondary)]"
        >
          <Icon name="info" size={16} className="shrink-0" />
          {t('adminPromotionsSameSiteHint')}
        </p>
      )}
    </li>
  );
}
