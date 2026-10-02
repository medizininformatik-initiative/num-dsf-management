/**
 * usePopover.ts – open state and dismissal of a non-modal popover anchored to
 * a trigger button (NotificationCenter, ActivityFeed). Opening moves focus
 * into the panel; Escape closes it and returns focus to the trigger; a
 * pointer-down outside or focus moving out of the root closes it too.
 * Escape is handled on the root element and marked handled
 * (preventDefault), so a surrounding dialog layer (useDialogLayer) ignores it
 * instead of closing as well. Spread rootProps on the element that wraps
 * trigger and panel; give the trigger triggerRef and the panel panelRef.
 * Dependencies: react.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from 'react';

export function usePopover() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus({ preventScroll: true });
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const toggle = useCallback(() => setOpen((value) => !value), []);
  const close = useCallback(() => setOpen(false), []);

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !open || event.nativeEvent.isComposing) return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    },
    [open],
  );

  const onBlur = useCallback(
    (event: FocusEvent) => {
      const next = event.relatedTarget;
      if (open && next instanceof Node && !rootRef.current?.contains(next)) setOpen(false);
    },
    [open],
  );

  return {
    open,
    toggle,
    close,
    triggerRef,
    panelRef,
    rootProps: { ref: rootRef, onKeyDown, onBlur },
  };
}
