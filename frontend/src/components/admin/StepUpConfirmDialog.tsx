/**
 * StepUpConfirmDialog.tsx – confirmation dialog for admin writes that need
 * the TOTP step-up: what is about to happen, an emphasised consequence,
 * optional extra fields (e.g. a reason) and, in OTP sessions, the 6-digit
 * authenticator code. Confirm stays disabled until the code is complete. Built
 * on the foundation Modal (animated, stacked, Escape, focus trap and restore);
 * pure confirmations without a code field use useConfirm() instead.
 * The code is controlled by the caller so it can clear a spent code after a
 * failed attempt while the dialog stays open.
 * Dependencies: Modal, Button, Icon, TotpCodeField, lib/authMode, i18n store.
 */
import type { ReactNode } from 'react';
import { Modal } from '../modals/Modal';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { needsTotpStepUp } from '../../lib/authMode';
import { useI18n } from '../../stores/i18n.store';
import { TotpCodeField } from './TotpCodeField';

export interface StepUpConfirmDialogProps {
  open: boolean;
  title: string;
  /** Shown under the title, e.g. the affected email address or CA. */
  subtitle?: string;
  message?: ReactNode;
  /** Emphasised line about what happens next. */
  consequence?: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  /** The write is in flight: confirm is disabled. */
  pending?: boolean;
  /** Blocks confirm, e.g. while a required reason is empty. */
  confirmDisabled?: boolean;
  /** Typed content: closing asks to discard it first. */
  isDirty?: boolean;
  totpCode: string;
  onTotpCodeChange: (code: string) => void;
  /** Called with the code in OTP sessions, undefined in certificate sessions. */
  onConfirm: (totpCode: string | undefined) => void;
  onCancel: () => void;
  /** Extra fields rendered above the code, e.g. a reason textarea. */
  children?: ReactNode;
}

export function StepUpConfirmDialog({
  open,
  title,
  subtitle,
  message,
  consequence,
  confirmLabel,
  destructive = false,
  pending = false,
  confirmDisabled = false,
  isDirty = false,
  totpCode,
  onTotpCodeChange,
  onConfirm,
  onCancel,
  children,
}: StepUpConfirmDialogProps) {
  const { t } = useI18n();
  const stepUp = needsTotpStepUp();
  const canConfirm = !pending && !confirmDisabled && (!stepUp || totpCode.length === 6);

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      subtitle={subtitle}
      width="max-w-md"
      isDirty={isDirty}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (canConfirm) onConfirm(stepUp ? totpCode : undefined);
        }}
      >
        {message && <div className="text-sm text-[color:var(--text-secondary)]">{message}</div>}
        {consequence && (
          <div className="flex gap-1.5 text-sm font-medium text-[color:var(--text-primary)]">
            <Icon name="warning" size={16} className="mt-0.5 shrink-0 text-danger-fg" />
            <div>{consequence}</div>
          </div>
        )}
        {children}
        {stepUp && (
          <TotpCodeField
            label={t('totpCodeLabel')}
            value={totpCode}
            onChange={onTotpCodeChange}
            hint={t('totpDigitsRequired')}
          />
        )}
        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onCancel}>
            {t('cancel')}
          </Button>
          <Button
            type="submit"
            variant={destructive ? 'destructive' : 'primary'}
            disabled={!canConfirm}
            aria-busy={pending || undefined}
          >
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
