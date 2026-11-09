/**
 * RestoreDialog.tsx – request to restore an older allow-list version.
 * Explains that a second admin from another site must approve it and that the
 * restored list then becomes the published list for every site,
 * requires a reason and, in OTP mode, a TOTP code (cert mode: the re-presented
 * client certificate is the step-up, no code field). Focus starts on the reason
 * field; Escape and the scrim cancel. Dependencies: DialogShell, Button, Icon,
 * fieldClasses, i18n store, lib/authMode.
 */
import { useId, useRef, useState, type FormEvent } from 'react';
import { DialogShell } from '../../ui/DialogShell';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { FIELD_CLASS, HINT_CLASS, LABEL_CLASS } from '../fieldClasses';
import { useI18n } from '../../../stores/i18n.store';
import { needsTotpStepUp } from '../../../lib/authMode';

interface Props {
  open: boolean;
  versionNumber: number;
  busy: boolean;
  /** Server-side error to show inline, e.g. a wrong TOTP code. */
  error?: string | null;
  onCancel: () => void;
  onConfirm: (input: { reason: string; totpCode?: string }) => void;
}

export function RestoreDialog({ open, versionNumber, busy, error, onCancel, onConfirm }: Props) {
  const { t } = useI18n();
  const titleId = useId();
  const messageId = useId();
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const [reason, setReason] = useState('');
  const [totp, setTotp] = useState('');
  const [touched, setTouched] = useState(false);
  const totpNeeded = needsTotpStepUp();

  const reasonMissing = reason.trim().length === 0;
  const totpMissing = totpNeeded && !/^\d{6}$/.test(totp);
  const localError = !touched
    ? null
    : reasonMissing
      ? t('historyRestoreReasonRequired')
      : totpMissing
        ? t('historyRestoreTotpRequired')
        : null;
  const shownError = localError ?? error ?? null;

  function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (reasonMissing || totpMissing || busy) return;
    onConfirm({ reason: reason.trim(), ...(totpNeeded ? { totpCode: totp } : {}) });
  }

  return (
    <DialogShell
      open={open}
      onDismiss={onCancel}
      labelledBy={titleId}
      describedBy={messageId}
      initialFocusRef={reasonRef}
      className="max-w-md"
    >
      <form noValidate onSubmit={submit} className="space-y-4 p-6">
        <div>
          <h2 id={titleId} className="text-base font-semibold text-[color:var(--text-primary)]">
            {t('historyRestoreTitle', { n: versionNumber })}
          </h2>
          <p id={messageId} className="mt-1 text-sm text-[color:var(--text-secondary)]">
            {t('historyRestoreMessage', { n: versionNumber })}
          </p>
          <p className="mt-2 text-sm font-semibold text-[color:var(--text-primary)]">
            {t('historyRestoreConsequence')}
          </p>
        </div>

        <div>
          <label htmlFor={`${titleId}-reason`} className={LABEL_CLASS}>
            {t('historyRestoreReason')}
          </label>
          <textarea
            id={`${titleId}-reason`}
            ref={reasonRef}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={500}
            aria-required="true"
            className={FIELD_CLASS}
          />
          <p className={HINT_CLASS}>{t('historyRestoreReasonHint')}</p>
        </div>

        {totpNeeded ? (
          <div>
            <label htmlFor={`${titleId}-totp`} className={LABEL_CLASS}>
              {t('historyRestoreTotp')}
            </label>
            <input
              id={`${titleId}-totp`}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={totp}
              onChange={(e) => setTotp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className={`${FIELD_CLASS} max-w-[15rem] text-center font-mono tracking-[0.3em]`}
            />
          </div>
        ) : (
          <p className="flex items-center gap-2 text-xs text-[color:var(--text-muted)]">
            <Icon name="badge" size={14} />
            {t('historyRestoreCertHint')}
          </p>
        )}

        {shownError && (
          <p role="alert" className="text-sm font-medium text-danger-fg">
            {shownError}
          </p>
        )}

        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button type="submit" disabled={busy}>
            {t('historyRestoreConfirm')}
          </Button>
        </div>
      </form>
    </DialogShell>
  );
}
