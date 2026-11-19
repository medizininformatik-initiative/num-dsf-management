/**
 * BlockLiftPanel.tsx – the certificate blocks of a false-alarm incident and their four-eyes lift,
 * in the incident admin panel. Lists every blocked thumbprint with its lifted state, offers
 * "Request lifting the blocks" (reason + step-up) while one is still blocked, and shows the open
 * request with Confirm (another admin of a different e-mail domain; the buttons say why not
 * otherwise) and Cancel (the requester). The dialogs state the consequences.
 * Dependencies: useBlockLifts, useBlockLiftActions, useMe, StepUpConfirmDialog, incidentErrors,
 * Button, Icon, StatusPill, dateUtils, i18n store, sonner.
 */
import { useId, useState } from 'react';
import { toast } from 'sonner';
import type { Incident } from '../../api/incidents.api';
import { useBlockLiftActions } from '../../hooks/useIncidentActions';
import { useBlockLifts } from '../../hooks/useIncidents';
import { useMe } from '../../hooks/useMe';
import { relTime } from '../../lib/dateUtils';
import { useI18n } from '../../stores/i18n.store';
import type { TranslationKey } from '../../i18n/en';
import { StepUpConfirmDialog } from '../admin/StepUpConfirmDialog';
import { FIELD_CLASS, LABEL_CLASS } from '../admin/fieldClasses';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { StatusPill } from '../ui/StatusPill';
import { incidentErrorMessage } from './incidentErrors';

type Action = 'request' | 'confirm' | 'cancel';

const siteOf = (email: string) => (email.split('@')[1] || '').toLowerCase();

export function BlockLiftPanel({ incident }: { incident: Incident }) {
  const { t } = useI18n();
  const titleId = useId();
  const reasonId = useId();
  const me = useMe().data?.email ?? null;
  const { data } = useBlockLifts(incident.id);
  const actions = useBlockLiftActions(incident.id);
  const [action, setAction] = useState<Action | null>(null);
  const [code, setCode] = useState('');
  const [reason, setReason] = useState('');

  const blocks = data?.blocks ?? [];
  const request = data?.request ?? null;
  const stillBlocked = blocks.some((b) => !b.lifted);
  const mine =
    me !== null && request !== null && request.requestedBy.toLowerCase() === me.toLowerCase();
  const confirmBlocker: TranslationKey | null =
    me === null || request === null
      ? null
      : mine
        ? 'blockLiftOwnHint'
        : siteOf(request.requestedBy) === siteOf(me)
          ? 'blockLiftSameSiteHint'
          : null;

  function close() {
    setAction(null);
    setCode('');
  }

  function fail(err: unknown) {
    setCode('');
    toast.error(incidentErrorMessage(err, t('genericActionFailed'), t));
  }

  function submit(totpCode: string | undefined) {
    if (action === 'request') {
      actions.request.mutate(
        { reason: reason.trim(), totpCode },
        {
          onSuccess: () => {
            toast.success(t('blockLiftRequestedToast'));
            setReason('');
            close();
          },
          onError: fail,
        },
      );
    } else if (action === 'confirm' && request) {
      actions.confirm.mutate(
        { requestId: request.id, totpCode },
        {
          onSuccess: (r) => {
            if (r.published) {
              toast.success(
                t('blockLiftConfirmedToast', { n: r.lifted, version: r.versionNumber ?? '' }),
              );
            } else {
              toast.warning(t('blockLiftConfirmedNoVersionToast', { n: r.lifted }));
            }
            close();
          },
          onError: fail,
        },
      );
    } else if (action === 'cancel' && request) {
      actions.cancel.mutate(
        { requestId: request.id, totpCode },
        {
          onSuccess: () => {
            toast.success(t('blockLiftCancelledToast'));
            close();
          },
          onError: fail,
        },
      );
    }
  }

  const busy = actions.request.isPending || actions.confirm.isPending || actions.cancel.isPending;
  const TITLE = {
    request: 'blockLiftRequestTitle',
    confirm: 'blockLiftConfirmTitle',
    cancel: 'blockLiftCancelTitle',
  } as const;
  const BODY = {
    request: 'blockLiftRequestBody',
    confirm: 'blockLiftConfirmBody',
    cancel: 'blockLiftCancelBody',
  } as const;
  const CONFIRM = {
    request: 'blockLiftRequest',
    confirm: 'blockLiftConfirm',
    cancel: 'blockLiftCancel',
  } as const;

  return (
    <section
      aria-labelledby={titleId}
      className="surface-card space-y-3 p-5"
      data-testid="block-lift-panel"
    >
      <div>
        <h3 id={titleId} className="text-base font-semibold text-[color:var(--text-primary)]">
          {t('blockLiftTitle')}
        </h3>
        <p className="mt-1 text-sm text-[color:var(--text-secondary)]">{t('blockLiftIntro')}</p>
      </div>

      {blocks.length === 0 ? (
        <p className="text-sm text-[color:var(--text-muted)]">{t('blockLiftNone')}</p>
      ) : (
        <ul className="divide-y divide-[color:var(--border)]" data-testid="block-lift-list">
          {blocks.map((b) => (
            <li
              key={b.fingerprint}
              className="flex flex-wrap items-center justify-between gap-2 py-2"
            >
              <div className="min-w-0">
                <p
                  className="break-all font-mono text-xs text-[color:var(--text-primary)]"
                  title={b.fingerprint}
                >
                  {b.fingerprint.slice(0, 32)}…
                </p>
                <p className="text-2xs text-[color:var(--text-muted)]">
                  {b.lifted
                    ? t('blockLiftLiftedBy', {
                        who: b.liftedBy ?? '—',
                        when: b.liftedAt ? relTime(b.liftedAt, t) : '—',
                      })
                    : t('blockLiftBlockedBy', { who: b.blockedBy, when: relTime(b.blockedAt, t) })}
                </p>
              </div>
              <StatusPill
                tone={b.lifted ? 'success' : 'danger'}
                icon={b.lifted ? 'lock_open' : 'lock'}
              >
                {b.lifted ? t('blockLiftLifted') : t('blockLiftBlocked')}
              </StatusPill>
            </li>
          ))}
        </ul>
      )}

      {request && (
        <div
          className="space-y-2 rounded-control border border-warning-border bg-warning-surface p-3 text-sm"
          data-testid="block-lift-request"
        >
          <p className="font-semibold text-warning-fg">{t('blockLiftPendingTitle')}</p>
          <p className="text-xs text-[color:var(--text-primary)]">
            {t('blockLiftReasonLine', { reason: request.reason })}
          </p>
          <p className="text-xs text-[color:var(--text-muted)]">
            {t('blockLiftPendingMeta', {
              who: request.requestedBy,
              when: relTime(request.requestedAt, t),
            })}
          </p>
          {confirmBlocker && (
            <p className="flex items-center gap-1.5 text-xs text-[color:var(--text-secondary)]">
              <Icon name="info" size={14} className="shrink-0" />
              {t(confirmBlocker)}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={confirmBlocker !== null}
              onClick={() => setAction('confirm')}
            >
              <Icon name="lock_open" size={16} />
              {t('blockLiftConfirm')}
            </Button>
            {mine && (
              <Button size="sm" variant="secondary" onClick={() => setAction('cancel')}>
                {t('blockLiftCancel')}
              </Button>
            )}
          </div>
        </div>
      )}

      {!request && stillBlocked && (
        <Button variant="secondary" size="sm" onClick={() => setAction('request')}>
          <Icon name="lock_open" size={16} />
          {t('blockLiftRequest')}
        </Button>
      )}

      <StepUpConfirmDialog
        open={action !== null}
        title={action ? t(TITLE[action]) : ''}
        subtitle={incident.title}
        message={action ? t(BODY[action]) : undefined}
        confirmLabel={action ? t(CONFIRM[action]) : t('confirm')}
        destructive={action !== 'cancel'}
        pending={busy}
        confirmDisabled={action === 'request' && reason.trim() === ''}
        isDirty={action === 'request' && reason.trim() !== ''}
        totpCode={code}
        onTotpCodeChange={setCode}
        onConfirm={submit}
        onCancel={close}
      >
        {action === 'request' && (
          <div>
            <label htmlFor={reasonId} className={LABEL_CLASS}>
              {t('blockLiftReason')}
            </label>
            <textarea
              id={reasonId}
              value={reason}
              maxLength={2000}
              rows={3}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('blockLiftReasonPlaceholder')}
              className={`${FIELD_CLASS} resize-y`}
            />
          </div>
        )}
      </StepUpConfirmDialog>
    </section>
  );
}
