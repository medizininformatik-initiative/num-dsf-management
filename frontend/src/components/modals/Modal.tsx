/**
 * Modal.tsx — the app's dialog primitive; every entity modal builds on it.
 * A glass panel over a blurred scrim that springs in and leaves faster
 * (DialogShell), stacked so that only the top-most dialog reacts to Escape and
 * scrim clicks, with Tab kept inside, focus restored to the opener on close and
 * the panel labelled by its title. With `isDirty`, Escape, the scrim and the
 * close button first ask to discard the changes (ConfirmDialog).
 * Dependencies: DialogShell, ConfirmDialog, Icon, i18n store.
 */
import React, { useId, useState } from 'react';
import { useI18n } from '../../stores/i18n.store';
import { DialogShell } from '../ui/DialogShell';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Icon } from '../ui/Icon';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  /** Tailwind max-width class of the panel. */
  width?: string;
  /** Unsaved changes: closing via Escape, scrim or the close button asks first. */
  isDirty?: boolean;
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  width = 'max-w-lg',
  isDirty = false,
}: ModalProps) {
  const { t } = useI18n();
  const titleId = useId();
  const subtitleId = useId();
  const [askDiscard, setAskDiscard] = useState(false);
  // Never carry a pending question over into the next opening.
  if (!open && askDiscard) setAskDiscard(false);
  const requestClose = () => (isDirty ? setAskDiscard(true) : onClose());

  return (
    <>
      <DialogShell
        open={open}
        onDismiss={requestClose}
        labelledBy={titleId}
        describedBy={subtitle ? subtitleId : undefined}
        className={`overflow-hidden ${width}`}
      >
        <div className="flex items-center justify-between gap-4 border-b border-[color:var(--border)] px-6 pb-4 pt-6">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-bold text-[color:var(--text-primary)]">
              {title}
            </h2>
            {subtitle && (
              <p id={subtitleId} className="mt-0.5 text-xs text-[color:var(--text-muted)]">
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={requestClose}
            aria-label={t('ariaClose')}
            className="press-effect rounded-lg p-1.5 text-[color:var(--text-muted)] hover:bg-[color:var(--bg-hover)] hover:text-[color:var(--text-primary)]"
          >
            <Icon name="close" size={20} />
          </button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto px-6 py-5">{children}</div>
      </DialogShell>
      <ConfirmDialog
        open={open && askDiscard}
        title={t('confirmDiscardTitle')}
        message={t('confirmDiscardMessage')}
        confirmLabel={t('confirmDiscardConfirmBtn')}
        cancelLabel={t('confirmDiscardCancelBtn')}
        destructive
        onConfirm={() => {
          setAskDiscard(false);
          onClose();
        }}
        onCancel={() => setAskDiscard(false)}
      />
    </>
  );
}
