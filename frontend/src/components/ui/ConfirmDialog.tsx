/**
 * ConfirmDialog.tsx – modal confirmation (role="alertdialog") for destructive
 * or irreversible actions: title, message, an optional emphasised consequence,
 * Cancel and a confirm button in the error colour when `destructive`. Focus
 * starts on Cancel, so Enter never confirms by accident; Escape and a scrim
 * click cancel. Use it controlled via `open`, or imperatively through
 * useConfirm() — ConfirmProvider (mounted once in src/main.tsx) renders one
 * on demand. Dependencies: DialogShell, Button, Icon, i18n store, useConfirm.
 */
import { useCallback, useId, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '../../stores/i18n.store';
import { ConfirmContext, type ConfirmOptions } from '../../hooks/useConfirm';
import { DialogShell } from './DialogShell';
import { Button } from './Button';
import { Icon } from './Icon';

export interface ConfirmDialogProps extends ConfirmOptions {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  consequence,
  confirmLabel,
  cancelLabel,
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useI18n();
  const titleId = useId();
  const messageId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  return (
    <DialogShell
      open={open}
      onDismiss={onCancel}
      role="alertdialog"
      labelledBy={titleId}
      describedBy={messageId}
      initialFocusRef={cancelRef}
      zIndex={300}
      className="max-w-sm p-6"
    >
      <h2 id={titleId} className="text-base font-semibold text-[color:var(--text-primary)]">
        {title}
      </h2>
      <div id={messageId} className="mt-2 space-y-2 text-sm text-[color:var(--text-secondary)]">
        <div>{message}</div>
        {consequence && (
          <div className="flex gap-1.5 font-medium text-[color:var(--text-primary)]">
            <Icon name="warning" size={16} className="mt-0.5 shrink-0 text-danger-fg" />
            <div>{consequence}</div>
          </div>
        )}
      </div>
      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button ref={cancelRef} variant="secondary" onClick={onCancel}>
          {cancelLabel ?? t('cancel')}
        </Button>
        <Button variant={destructive ? 'destructive' : 'primary'} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </DialogShell>
  );
}

/** Supplies useConfirm(); renders the requested ConfirmDialog. Mount once. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<{ options: ConfirmOptions; open: boolean } | null>(null);
  const resolveRef = useRef<((confirmed: boolean) => void) | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    resolveRef.current?.(false);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
      setRequest({ options, open: true });
    });
  }, []);

  const settle = (confirmed: boolean) => {
    resolveRef.current?.(confirmed);
    resolveRef.current = null;
    setRequest((current) => current && { ...current, open: false });
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {request && (
        <ConfirmDialog
          {...request.options}
          open={request.open}
          onConfirm={() => settle(true)}
          onCancel={() => settle(false)}
        />
      )}
    </ConfirmContext.Provider>
  );
}
