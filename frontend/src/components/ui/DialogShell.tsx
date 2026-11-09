/**
 * DialogShell.tsx – the animated modal surface under Modal and ConfirmDialog:
 * a portal into document.body with a blurred scrim and a glass panel that
 * springs in (scale .96 + 8px rise) and leaves faster, easing in. Stacking,
 * Escape, the Tab trap and focus restore come from useDialogLayer; the
 * enter/exit lifecycle from usePresence. While closing it keeps rendering the
 * last open content, ignores the pointer and is hidden from assistive tech.
 * Build new dialog layouts on this rather than on a bare portal.
 * Dependencies: react-dom, usePresence, useDialogLayer, lib/motion.
 */
import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { usePresence } from '../../hooks/usePresence';
import { useDialogLayer } from '../../hooks/useDialogLayer';
import { exitMs } from '../../lib/motion';

export interface DialogShellProps {
  open: boolean;
  /** Escape or a click on the scrim while this dialog is top-most. */
  onDismiss: () => void;
  /** id of the visible title element (aria-labelledby). */
  labelledBy: string;
  /** id of the element describing the dialog (aria-describedby). */
  describedBy?: string;
  role?: 'dialog' | 'alertdialog';
  /** Focused on open; defaults to the first form field, else the panel. */
  initialFocusRef?: RefObject<HTMLElement>;
  /** Extra panel classes, e.g. a max-width such as 'max-w-lg'. */
  className?: string;
  /** Overlay stacking level; dialogs opened on top of others use a higher one. */
  zIndex?: number;
  children: ReactNode;
}

const EXIT_MS = exitMs('medium');

export function DialogShell({
  open,
  onDismiss,
  labelledBy,
  describedBy,
  role = 'dialog',
  initialFocusRef,
  className = '',
  zIndex = 200,
  children,
}: DialogShellProps) {
  const { mounted, state } = usePresence(open, EXIT_MS);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const lastOpenContent = useRef(children);
  if (open) lastOpenContent.current = children;
  const { isTop } = useDialogLayer({
    open,
    onEscape: onDismiss,
    containerRef: panelRef,
    initialFocusRef,
  });

  // Passive like useDialogLayer's effect, whose cleanup (focus restore) runs
  // before this, so aria-hidden never lands on an ancestor of the focused element.
  useEffect(() => {
    if (state === 'closed') rootRef.current?.setAttribute('aria-hidden', 'true');
    else rootRef.current?.removeAttribute('aria-hidden');
  }, [state, mounted]);

  if (!mounted) return null;
  return createPortal(
    <div
      ref={rootRef}
      data-state={state}
      style={{ zIndex }}
      className="fixed inset-0 flex items-center justify-center p-4 data-[state=closed]:pointer-events-none"
    >
      <div
        data-state={state}
        className="scrim absolute inset-0 data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out"
        onClick={(e) => {
          if (e.target === e.currentTarget && isTop()) onDismiss();
        }}
      />
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        data-state={state}
        className={`glass-thick relative w-full rounded-card outline-none data-[state=open]:animate-scale-in data-[state=closed]:animate-scale-out ${className}`}
      >
        {open ? children : lastOpenContent.current}
      </div>
    </div>,
    document.body,
  );
}
