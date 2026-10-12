/**
 * PendingCertRequestsCard.tsx – open four-eyes requests for a colleague's admin
 * certificate (card above the table on the users page). Each request shows
 * target, requester, subject, expiry and age. Eligible admins approve or
 * reject through a StepUpConfirmDialog; the buttons are disabled with a written
 * reason for the requester, the target and admins of the requester's site. The
 * requester can cancel. Renders nothing while no request is pending.
 * Dependencies: adminCertRequestsApi, useToastMutation, StepUpConfirmDialog,
 * Button, StatusPill, Icon, dateUtils, i18n store, tanstack-query.
 */
import { useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminCertRequestsApi, type AdminCertRequest } from '../../api/adminCertificates.api';
import { useToastMutation } from '../../hooks/useToastMutation';
import { StepUpConfirmDialog } from './StepUpConfirmDialog';
import { FIELD_CLASS, LABEL_CLASS } from './fieldClasses';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { StatusPill } from '../ui/StatusPill';
import { formatDate, relTime } from '../../lib/dateUtils';
import { useI18n } from '../../stores/i18n.store';
import type { TranslationKey } from '../../i18n/en';

const CERT_REQUESTS_KEY = ['admin', 'certificates', 'requests'] as const;

type Kind = 'approve' | 'reject' | 'cancel';

const siteOf = (email: string) => (email.split('@')[1] || '').toLowerCase();
const same = (a: string, b: string | null) => b != null && a.toLowerCase() === b.toLowerCase();

/** Why this viewer cannot approve, as a translation key (null = may approve). */
function approveBlocker(req: AdminCertRequest, me: string | null): TranslationKey | null {
  if (me == null) return null;
  if (same(req.requestedBy, me)) return 'adminCertReqOwnHint';
  if (same(req.targetEmail, me)) return 'adminCertReqTargetHint';
  if (siteOf(req.requestedBy) === siteOf(me)) return 'adminCertReqSameSiteHint';
  return null;
}

export function PendingCertRequestsCard({ meEmail }: { meEmail: string | null }) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const titleId = useId();
  const reasonId = useId();
  const [action, setAction] = useState<{ kind: Kind; req: AdminCertRequest } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [reason, setReason] = useState('');

  const { data } = useQuery({
    queryKey: CERT_REQUESTS_KEY,
    queryFn: adminCertRequestsApi.list,
    staleTime: 15_000,
  });
  const pending = (data ?? []).filter((r) => r.status === 'PENDING');

  const done = () => qc.invalidateQueries({ queryKey: ['admin', 'certificates'] });
  const errorFallback = t('genericActionFailed');
  const approve = useToastMutation({
    mutationFn: (v: { id: string; totpCode?: string }) =>
      adminCertRequestsApi.approve(v.id, v.totpCode),
    successMessage: t('adminCertReqApprovedToast'),
    onSuccess: done,
    errorFallback,
  });
  const reject = useToastMutation({
    mutationFn: (v: { id: string; comment: string; totpCode?: string }) =>
      adminCertRequestsApi.reject(v.id, v.comment, v.totpCode),
    successMessage: t('adminCertReqRejectedToast'),
    onSuccess: done,
    errorFallback,
  });
  const cancel = useToastMutation({
    mutationFn: (v: { id: string; totpCode?: string }) =>
      adminCertRequestsApi.cancel(v.id, v.totpCode),
    successMessage: t('adminCertReqCancelledToast'),
    onSuccess: done,
    errorFallback,
  });

  if (pending.length === 0) return null;

  function close() {
    setAction(null);
    setTotpCode('');
    setReason('');
  }

  function confirm(code: string | undefined) {
    if (!action) return;
    const totp = code !== undefined ? { totpCode: code } : {};
    const settle = { onSuccess: close, onError: () => setTotpCode('') };
    const id = action.req.id;
    if (action.kind === 'approve') approve.mutate({ id, ...totp }, settle);
    else if (action.kind === 'reject')
      reject.mutate({ id, comment: reason.trim(), ...totp }, settle);
    else cancel.mutate({ id, ...totp }, settle);
  }

  const busy = approve.isPending || reject.isPending || cancel.isPending;
  const TITLE: Record<Kind, TranslationKey> = {
    approve: 'adminCertReqApproveTitle',
    reject: 'adminCertReqRejectTitle',
    cancel: 'adminCertReqCancelTitle',
  };
  const BODY: Record<Kind, TranslationKey> = {
    approve: 'adminCertReqApproveBody',
    reject: 'adminCertReqRejectBody',
    cancel: 'adminCertReqCancelBody',
  };
  const CONFIRM: Record<Kind, TranslationKey> = {
    approve: 'adminCertReqApprove',
    reject: 'adminCertReqReject',
    cancel: 'adminCertReqCancel',
  };

  return (
    <section
      aria-labelledby={titleId}
      data-testid="pending-cert-requests"
      className="glass-thin rounded-2xl p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={titleId} className="text-base font-semibold text-[color:var(--text-primary)]">
          {t('adminCertReqTitle')}
        </h2>
        <StatusPill tone="warning" icon="hourglass_top">
          {pending.length}
        </StatusPill>
      </div>
      <p className="mt-1 text-sm text-[color:var(--text-secondary)]">{t('adminCertReqHint')}</p>
      <ul className="mt-3 divide-y divide-[color:var(--border)]">
        {pending.map((req) => {
          const blocker = approveBlocker(req, meEmail);
          const mine = same(req.requestedBy, meEmail);
          const hintId = `${titleId}-${req.id}`;
          return (
            <li key={req.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0 space-y-0.5 text-sm">
                <p className="font-semibold text-[color:var(--text-primary)]">
                  {t('adminCertReqFor', { who: req.targetEmail })}
                </p>
                <p className="break-all text-xs text-[color:var(--text-secondary)]">
                  {req.label ? `${req.label} · ` : ''}
                  {req.subject ?? '—'}
                  {req.validUntil
                    ? ` · ${t('adminCertReqValidUntil', { date: formatDate(req.validUntil, lang) })}`
                    : ''}
                </p>
                <p className="text-xs text-[color:var(--text-muted)]">
                  {t('adminCertReqMeta', {
                    who: req.requestedBy,
                    when: relTime(req.createdAt, t),
                  })}
                </p>
                {blocker && (
                  <p
                    id={hintId}
                    className="flex items-center gap-1.5 pt-1 text-xs text-[color:var(--text-secondary)]"
                  >
                    <Icon name="info" size={16} className="shrink-0" />
                    {t(blocker)}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  size="sm"
                  disabled={blocker !== null}
                  aria-describedby={blocker ? hintId : undefined}
                  onClick={() => setAction({ kind: 'approve', req })}
                >
                  <Icon name="check" size={16} />
                  {t('adminCertReqApprove')}
                </Button>
                {mine ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setAction({ kind: 'cancel', req })}
                  >
                    {t('adminCertReqCancel')}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="text-danger-fg"
                    onClick={() => setAction({ kind: 'reject', req })}
                  >
                    <Icon name="close" size={16} />
                    {t('adminCertReqReject')}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <StepUpConfirmDialog
        open={action !== null}
        title={action ? t(TITLE[action.kind]) : ''}
        subtitle={action?.req.targetEmail}
        message={action ? t(BODY[action.kind]) : undefined}
        confirmLabel={action ? t(CONFIRM[action.kind]) : t('confirm')}
        destructive={action?.kind !== 'approve'}
        pending={busy}
        confirmDisabled={action?.kind === 'reject' && reason.trim() === ''}
        isDirty={action?.kind === 'reject' && reason.trim() !== ''}
        totpCode={totpCode}
        onTotpCodeChange={setTotpCode}
        onConfirm={confirm}
        onCancel={close}
      >
        {action?.kind === 'reject' && (
          <div>
            <label htmlFor={reasonId} className={LABEL_CLASS}>
              {t('adminCertReqRejectReason')}
            </label>
            <textarea
              id={reasonId}
              value={reason}
              maxLength={1000}
              rows={3}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('adminCertReqRejectPlaceholder')}
              className={`${FIELD_CLASS} resize-y`}
            />
          </div>
        )}
      </StepUpConfirmDialog>
    </section>
  );
}
