/**
 * useDialogLayer.ts – stacking, keyboard and focus behaviour shared by every
 * modal dialog (Modal, ConfirmDialog, CrossUserConfirmDialog).
 *
 * Open dialogs form a stack; the one opened last is top-most. A single
 * document keydown listener serves only the top-most dialog, so nested
 * dialogs never react together:
 *  - Escape calls its onEscape — unless a control inside already handled the
 *    key (event.preventDefault()) or an IME composition is in progress;
 *  - Tab / Shift+Tab cycle focus inside its container.
 * While open, the hook also locks body scroll and moves focus into the dialog
 * (initialFocusRef, else the first form field, else the container itself, so
 * give the container tabIndex={-1}). On close it returns focus to the element
 * that was focused when the dialog opened, unless the user has moved focus
 * elsewhere meanwhile. Gate backdrop clicks with isTop().
 *
 * Dependencies: react.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

export interface DialogLayerOptions {
  /** The dialog's open prop: the layer is registered while true. */
  open: boolean;
  /** Called when Escape is pressed while this dialog is top-most. */
  onEscape: () => void;
  /** The dialog element; focus starts and stays inside it. */
  containerRef: RefObject<HTMLElement>;
  /** Element to focus on open, e.g. a confirmation's Cancel button. */
  initialFocusRef?: RefObject<HTMLElement>;
}

interface Layer {
  container: () => HTMLElement | null;
  escape: () => void;
}

const stack: Layer[] = [];
let bodyOverflow = '';

const FIELD =
  'input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled])';
const TABBABLE = `${FIELD},a[href],button:not([disabled]),[tabindex]`;

function onKeyDown(event: KeyboardEvent) {
  const top = stack[stack.length - 1];
  const container = top && top.container();
  if (!top || !container || event.defaultPrevented || event.isComposing) return;

  if (event.key === 'Escape') {
    event.preventDefault();
    top.escape();
  } else if (event.key === 'Tab') {
    const items = Array.from(container.querySelectorAll<HTMLElement>(TABBABLE)).filter(
      (el) => el.getAttribute('tabindex') !== '-1',
    );
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    const outside = !container.contains(active) || active === container;
    if (!first) {
      event.preventDefault();
      container.focus();
    } else if (event.shiftKey ? outside || active === first : outside || active === last) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  }
}

export function useDialogLayer({
  open,
  onEscape,
  containerRef,
  initialFocusRef,
}: DialogLayerOptions): { isTop: () => boolean } {
  const escapeRef = useRef(onEscape);
  useLayoutEffect(() => {
    escapeRef.current = onEscape;
  });
  const [layer] = useState<Layer>(() => ({
    container: () => containerRef.current,
    escape: () => escapeRef.current(),
  }));

  // A passive effect on purpose: React re-focuses the previously focused
  // element at the end of each commit, which would undo a focus restore made
  // in a layout-effect cleanup while the closing dialog is still mounted.
  useEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    const opener = document.activeElement;
    const returnTo =
      opener instanceof HTMLElement && opener !== document.body && !container?.contains(opener)
        ? opener
        : null;

    if (!stack.length) {
      document.addEventListener('keydown', onKeyDown);
      bodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    stack.push(layer);
    if (container && !container.contains(document.activeElement)) {
      (
        initialFocusRef?.current ??
        container.querySelector<HTMLElement>(FIELD) ??
        container
      ).focus();
    }

    return () => {
      const index = stack.indexOf(layer);
      if (index < 0) return;
      // Restore only if focus is still in this dialog (or one stacked above
      // it, closing in the same update) or was lost to <body>.
      const active = document.activeElement;
      const focusLost = !active || active === document.body;
      if (
        returnTo?.isConnected &&
        (focusLost || stack.slice(index).some((l) => l.container()?.contains(active)))
      ) {
        returnTo.focus();
      }
      stack.splice(index, 1);
      if (!stack.length) {
        document.removeEventListener('keydown', onKeyDown);
        document.body.style.overflow = bodyOverflow;
      }
    };
  }, [open, layer, containerRef, initialFocusRef]);

  const isTop = useCallback(() => stack[stack.length - 1] === layer, [layer]);
  return { isTop };
}
