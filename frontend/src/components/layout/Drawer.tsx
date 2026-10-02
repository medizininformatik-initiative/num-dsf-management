/**
 * Drawer.tsx – modal side sheet of the narrow app shell (< 1200 px): the
 * sidebar and the status panel slide in from their edge on a thick glass
 * panel over a dimmed, blurred scrim (the foundation sheet animation, leaving
 * faster than it arrives). Stacking, Escape, the Tab trap, scroll lock and
 * focus restore come from useDialogLayer, the enter/exit lifecycle from
 * usePresence. While closing it keeps the last open content, ignores the
 * pointer and is hidden from assistive tech. It sits above popovers
 * (z-index 100) and below dialogs (200+), so a dialog opened from a drawer
 * stacks on top of it.
 * Dependencies: react-dom, usePresence, useDialogLayer, lib/motion.
 */
import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { usePresence } from '../../hooks/usePresence';
import { useDialogLayer } from '../../hooks/useDialogLayer';
import { exitMs } from '../../lib/motion';

export interface DrawerProps {
  open: boolean;
  /** Escape or a click on the scrim while this drawer is top-most. */
  onClose: () => void;
  /** Edge the sheet slides in from. */
  side: 'left' | 'right';
  /** Accessible name, unless a visible title names it through labelledBy. */
  label?: string;
  labelledBy?: string;
  /** id of the panel, for the opener's aria-controls. */
  id?: string;
  /** Focused on open, e.g. the close button; defaults to the first form field, else the panel. */
  initialFocusRef?: RefObject<HTMLElement>;
  /** Width classes of the panel, e.g. 'w-[280px] max-w-[85vw]'. */
  className?: string;
  children: ReactNode;
}

// The sheet leaves on --duration-long-exit; the scrim fades out sooner.
const EXIT_MS = exitMs('long');

const SIDE_CLASS = {
  left: 'left-0 rounded-r-2xl border-l-0 data-[state=open]:animate-sheet-in-left data-[state=closed]:animate-sheet-out-left',
  right:
    'right-0 rounded-l-2xl border-r-0 data-[state=open]:animate-sheet-in-right data-[state=closed]:animate-sheet-out-right',
} as const;

export function Drawer({
  open,
  onClose,
  side,
  label,
  labelledBy,
  id,
  initialFocusRef,
  className = '',
  children,
}: DrawerProps) {
  const { mounted, state } = usePresence(open, EXIT_MS);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const lastOpenContent = useRef(children);
  if (open) lastOpenContent.current = children;
  const { isTop } = useDialogLayer({
    open,
    onEscape: onClose,
    containerRef: panelRef,
    initialFocusRef,
  });

  // Passive like useDialogLayer's effect, whose cleanup (focus restore) runs
  // first, so aria-hidden never lands on an ancestor of the focused element.
  useEffect(() => {
    if (state === 'closed') rootRef.current?.setAttribute('aria-hidden', 'true');
    else rootRef.current?.removeAttribute('aria-hidden');
  }, [state, mounted]);

  if (!mounted) return null;
  return createPortal(
    <div
      ref={rootRef}
      data-state={state}
      className="fixed inset-0 z-[150] data-[state=closed]:pointer-events-none"
    >
      <div
        data-state={state}
        className="scrim absolute inset-0 data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out"
        onClick={(e) => {
          if (e.target === e.currentTarget && isTop()) onClose();
        }}
      />
      <div
        ref={panelRef}
        id={id}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-labelledby={labelledBy}
        tabIndex={-1}
        data-state={state}
        className={`glass-thick absolute inset-y-0 flex flex-col overflow-hidden outline-none ${SIDE_CLASS[side]} ${className}`}
      >
        {open ? children : lastOpenContent.current}
      </div>
    </div>,
    document.body,
  );
}
