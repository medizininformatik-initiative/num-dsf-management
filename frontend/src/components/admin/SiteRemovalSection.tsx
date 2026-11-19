/**
 * SiteRemovalSection.tsx – Remove a whole site with two admins (admin page).
 * A form requests the removal (site + reason, step-up); open requests list
 * Confirm for an eligible second admin (another e-mail domain, not the
 * requester) and Cancel for the requester. The consequences are spelled out in
 * the dialogs. Executed removals of the last 30 days are listed below.
 * Dependencies: adminInstanceRemovalsApi, StepUpConfirmDialog, useToastMutation,
 * Button, Icon, StatusPill, dateUtils, i18n store, tanstack-query, sonner.
 */
import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  adminInstanceRemovalsApi,
  type InstanceRemoval,
} from '../../api/adminInstanceRemovals.api';
import { useToastMutation } from '../../hooks/useToastMutation';
import { getErrorMessageForStepUp } from '../../lib/getErrorMessage';
import { StepUpConfirmDialog } from './StepUpConfirmDialog';
import { FIELD_CLASS, LABEL_CLASS } from './fieldClasses';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { StatusPill } from '../ui/StatusPill';
import { relTime } from '../../lib/dateUtils';
import { useI18n } from '../../stores/i18n.store';
import type { TranslationKey } from '../../i18n/en';

const REMOVALS_KEY = ['admin', 'instance-removals'] as const;
const INSTANCES_KEY = ['admin', 'instances'] as const;

type Action = { kind: 'request' } | { kind: 'confirm' | 'cancel'; removal: InstanceRemoval };

const siteOf = (email: string) => (email.split('@')[1] || '').toLowerCase();
const same = (a: string, b: string | null) => b != null && a.toLowerCase() === b.toLowerCase();

/** Why this viewer cannot confirm, as a translation key (null = may confirm). */
function confirmBlocker(removal: InstanceRemoval, me: string | null): TranslationKey | null {
  if (me == null) return null;
  if (same(removal.requestedBy, me)) return 'siteRemovalOwnHint';
  if (siteOf(removal.requestedBy) === siteOf(me)) return 'siteRemovalSameSiteHint';
  return null;
}

export function SiteRemovalSection({ meEmail }: { meEmail: string | null }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const titleId = useId();
  const pickId = useId();
  const reasonId = useId();
  const [instanceId, setInstanceId] = useState('');
  const [reason, setReason] = useState('');
  const [action, setAction] = useState<Action | null>(null);
  const [totpCode, setTotpCode] = useState('');

  const { data: removals } = useQuery({
    queryKey: REMOVALS_KEY,
    queryFn: adminInstanceRemovalsApi.list,
    staleTime: 15_000,
  });
  const { data: instances } = useQuery({
    queryKey: INSTANCES_KEY,
    queryFn: adminInstanceRemovalsApi.instances,
    staleTime: 60_000,
  });

  const pendingIds = new Set(
    (removals ?? []).filter((r) => r.status === 'PENDING').map((r) => r.instanceId),
  );
  const selectable = (instances ?? []).filter((i) => !i.removed_at && !pendingIds.has(i.id));
  const pending = (removals ?? []).filter((r) => r.status === 'PENDING');
  const done = (removals ?? []).filter((r) => r.status === 'CONFIRMED');

  const refresh = () => {
    qc.invalidateQueries({ queryKey: REMOVALS_KEY });
    qc.invalidateQueries({ queryKey: INSTANCES_KEY });
  };
  const errorFallback = t('genericActionFailed');
  const request = useToastMutation({
    mutationFn: (v: { instanceId: string; reason: string; totpCode?: string }) =>
      adminInstanceRemovalsApi.request(v.instanceId, v.reason, v.totpCode),
    successMessage: t('siteRemovalRequestedToast'),
    onSuccess: refresh,
    errorFallback,
    errorMessages: { REQUEST_ALREADY_PENDING: t('siteRemovalAlreadyPending') },
  });
  const cancel = useToastMutation({
    mutationFn: (v: { id: string; totpCode?: string }) =>
      adminInstanceRemovalsApi.cancel(v.id, v.totpCode),
    successMessage: t('siteRemovalCancelledToast'),
    onSuccess: refresh,
    errorFallback,
  });
  const confirm = useMutation({
    mutationFn: (v: { id: string; totpCode?: string }) =>
      adminInstanceRemovalsApi.confirm(v.id, v.totpCode),
    onSuccess: (result) => {
      if (result.published) {
        toast.success(t('siteRemovalConfirmedToast', { version: result.versionNumber ?? '' }));
      } else {
        toast.warning(t('siteRemovalConfirmedNoVersionToast'));
      }
      refresh();
    },
    onError: (err: unknown) =>
      toast.error(getErrorMessageForStepUp(err, errorFallback, t('certStepUpFailedToast'))),
  });

  function close() {
    setAction(null);
    setTotpCode('');
  }

  function submit(code: string | undefined) {
    if (!action) return;
    const totp = code !== undefined ? { totpCode: code } : {};
    const settle = {
      onSuccess: () => {
        if (action.kind === 'request') {
          setInstanceId('');
          setReason('');
        }
        close();
      },
      onError: () => setTotpCode(''),
    };
    if (action.kind === 'request') {
      request.mutate({ instanceId, reason: reason.trim(), ...totp }, settle);
    } else if (action.kind === 'confirm') {
      confirm.mutate({ id: action.removal.id, ...totp }, settle);
    } else {
      cancel.mutate({ id: action.removal.id, ...totp }, settle);
    }
  }

  const busy = request.isPending || cancel.isPending || confirm.isPending;
  const TITLE = {
    request: 'siteRemovalRequestTitle',
    confirm: 'siteRemovalConfirmTitle',
    cancel: 'siteRemovalCancelTitle',
  } as const;
  const BODY = {
    request: 'siteRemovalRequestBody',
    confirm: 'siteRemovalConfirmBody',
    cancel: 'siteRemovalCancelBody',
  } as const;
  const CONFIRM = {
    request: 'siteRemovalRequest',
    confirm: 'siteRemovalConfirm',
    cancel: 'siteRemovalCancel',
  } as const;
  const labelOf = (id: string, org: string | null) =>
    org ?? instances?.find((i) => i.id === id)?.label ?? id;
  const dialogSubject = !action
    ? undefined
    : action.kind === 'request'
      ? instances?.find((i) => i.id === instanceId)?.org_identifier || undefined
      : labelOf(action.removal.instanceId, action.removal.organizationId);

  return (
    <section
      aria-labelledby={titleId}
      data-testid="site-removal"
      className="surface-card space-y-4 p-5"
    >
      <div>
        <h2 id={titleId} className="text-base font-semibold text-[color:var(--text-primary)]">
          {t('siteRemovalTitle')}
        </h2>
        <p className="mt-1 text-sm text-[color:var(--text-secondary)]">{t('siteRemovalIntro')}</p>
      </div>

      {pending.length > 0 && (
        <div data-testid="site-removal-pending">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-[color:var(--text-primary)]">
              {t('siteRemovalPendingTitle')}
            </h3>
            <StatusPill tone="warning" icon="hourglass_top">
              {pending.length}
            </StatusPill>
          </div>
          <ul className="mt-2 divide-y divide-[color:var(--border)]">
            {pending.map((removal) => {
              const blocker = confirmBlocker(removal, meEmail);
              const mine = same(removal.requestedBy, meEmail);
              const hintId = `${titleId}-${removal.id}`;
              return (
                <li
                  key={removal.id}
                  className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0 space-y-0.5 text-sm">
                    <p className="break-all font-semibold text-[color:var(--text-primary)]">
                      {labelOf(removal.instanceId, removal.organizationId)}
                    </p>
                    <p className="text-xs text-[color:var(--text-secondary)]">
                      {t('siteRemovalReasonLine', { reason: removal.reason })}
                    </p>
                    <p className="text-xs text-[color:var(--text-muted)]">
                      {t('siteRemovalMeta', {
                        who: removal.requestedBy,
                        when: relTime(removal.requestedAt, t),
                      })}
                    </p>
                    {blocker && (
                      <p
                        id={hintId}
                        className="flex items-center gap-1.5 pt-1 text-xs text-[color:var(--text-secondary)]"
                      >
                        <Icon name="info" size={14} className="shrink-0" />
                        {t(blocker)}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={blocker !== null}
                      aria-describedby={blocker ? hintId : undefined}
                      onClick={() => setAction({ kind: 'confirm', removal })}
                    >
                      <Icon name="delete" size={16} />
                      {t('siteRemovalConfirm')}
                    </Button>
                    {mine && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setAction({ kind: 'cancel', removal })}
                      >
                        {t('siteRemovalCancel')}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (instanceId && reason.trim()) setAction({ kind: 'request' });
        }}
      >
        <div>
          <label htmlFor={pickId} className={LABEL_CLASS}>
            {t('siteRemovalPick')}
          </label>
          <select
            id={pickId}
            value={instanceId}
            onChange={(e) => setInstanceId(e.target.value)}
            className={FIELD_CLASS}
          >
            <option value="">
              {selectable.length === 0 ? t('siteRemovalNoSites') : t('siteRemovalPickPlaceholder')}
            </option>
            {selectable.map((i) => (
              <option key={i.id} value={i.id}>
                {i.org_identifier ?? i.label}
                {i.org_name ? ` – ${i.org_name}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={reasonId} className={LABEL_CLASS}>
            {t('siteRemovalReason')}
          </label>
          <textarea
            id={reasonId}
            value={reason}
            maxLength={2000}
            rows={2}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('siteRemovalReasonPlaceholder')}
            className={`${FIELD_CLASS} resize-y`}
          />
        </div>
        <div className="flex gap-2 rounded-card border border-danger-border bg-danger-surface p-3 text-sm text-danger-fg">
          <Icon name="warning" size={18} className="mt-0.5 shrink-0" />
          <p>{t('siteRemovalWarning')}</p>
        </div>
        <Button type="submit" variant="destructive" disabled={!instanceId || !reason.trim()}>
          {t('siteRemovalRequest')}
        </Button>
      </form>

      {done.length > 0 && (
        <div data-testid="site-removal-done">
          <h3 className="text-sm font-semibold text-[color:var(--text-primary)]">
            {t('siteRemovalDoneTitle')}
          </h3>
          <ul className="mt-2 space-y-1 text-xs text-[color:var(--text-secondary)]">
            {done.map((removal) => (
              <li key={removal.id} className="break-all">
                <span className="font-semibold">
                  {labelOf(removal.instanceId, removal.organizationId)}
                </span>
                {' · '}
                {t('siteRemovalDoneMeta', {
                  who: removal.decidedBy ?? '—',
                  when: removal.decidedAt ? relTime(removal.decidedAt, t) : '—',
                })}
              </li>
            ))}
          </ul>
        </div>
      )}

      <StepUpConfirmDialog
        open={action !== null}
        title={action ? t(TITLE[action.kind]) : ''}
        subtitle={dialogSubject}
        message={action ? t(BODY[action.kind]) : undefined}
        consequence={action?.kind === 'cancel' ? undefined : t('siteRemovalWarning')}
        confirmLabel={action ? t(CONFIRM[action.kind]) : t('confirm')}
        destructive
        pending={busy}
        totpCode={totpCode}
        onTotpCodeChange={setTotpCode}
        onConfirm={submit}
        onCancel={close}
      />
    </section>
  );
}
