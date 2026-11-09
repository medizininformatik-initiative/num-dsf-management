/**
 * CrossUserConfirmDialog.tsx – Confirmation modal shown when an admin attempts
 * to mutate data on an instance they don't own. Pure presentational; it joins
 * the dialog stack (useDialogLayer), so Escape or a backdrop click here never
 * also closes the form modal underneath. It wears the material of the other
 * dialogs: the scrim, a thick glass panel and the shared .btn classes.
 * Dependencies: useDialogLayer, i18n store, ui/Icon, .btn* (src/index.css).
 */
import { useId, useRef } from 'react';
import { useI18n } from '../../stores/i18n.store';
import { useDialogLayer } from '../../hooks/useDialogLayer';
import { Icon } from '../ui/Icon';

interface Props {
  open: boolean;
  ownerEmail: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function CrossUserConfirmDialog({ open, ownerEmail, onConfirm, onCancel }: Props) {
  const { t } = useI18n();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const { isTop } = useDialogLayer({
    open,
    onEscape: onCancel,
    containerRef: dialogRef,
    initialFocusRef: cancelRef,
  });

  if (!open) return null;
  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="scrim fixed inset-0 z-[1000] flex items-center justify-center"
      onClick={(e) => {
        if (e.target === e.currentTarget && isTop()) onCancel();
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-thick w-[90%] max-w-[440px] rounded-card p-6"
      >
        <div className="flex items-center gap-2.5">
          <Icon name="warning" size={20} className="shrink-0 text-warning-fg" />
          <h2 id={titleId} className="text-base font-semibold text-[color:var(--text-primary)]">
            {t('crossUserDialogTitle')}
          </h2>
        </div>
        <p className="mt-2 text-sm text-[color:var(--text-secondary)]">
          {t('crossUserDialogBody', { owner: ownerEmail ?? t('crossUserDialogAnotherUser') })}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            ref={cancelRef}
            onClick={onCancel}
            className="btn press-effect btn-md btn-secondary"
          >
            {t('crossUserCancelBtn')}
          </button>
          <button onClick={onConfirm} className="btn press-effect btn-md btn-primary">
            {t('crossUserContinueBtn')}
          </button>
        </div>
      </div>
    </div>
  );
}
