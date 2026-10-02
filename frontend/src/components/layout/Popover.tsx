/**
 * Popover.tsx – the floating glass surface of a non-modal popover (thin
 * material). It grows from the edge or corner touching its trigger
 * (origin-aware scale + fade, foundation popover animation) and leaves faster
 * via usePresence; while closing it keeps its last content, ignores the
 * pointer and is hidden from assistive tech. Position it with className
 * (e.g. 'right-0 top-full mt-2') inside a relative parent; pair it with
 * usePopover for focus and dismissal. Focusable (tabIndex -1) so the popover
 * can move focus into it.
 * Dependencies: react, usePresence, lib/motion.
 */
import { forwardRef, useRef, type HTMLAttributes, type ReactNode } from 'react';
import { usePresence } from '../../hooks/usePresence';
import { exitMs } from '../../lib/motion';

export type PopoverOrigin = 'top' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

const ORIGIN_CLASS: Record<PopoverOrigin, string> = {
  top: 'origin-top',
  'top-left': 'origin-top-left',
  'top-right': 'origin-top-right',
  'bottom-left': 'origin-bottom-left',
  'bottom-right': 'origin-bottom-right',
};

const EXIT_MS = exitMs('short');

export interface PopoverPanelProps extends HTMLAttributes<HTMLDivElement> {
  open: boolean;
  /** Where the panel touches its trigger; it scales in from there. */
  origin: PopoverOrigin;
  children: ReactNode;
}

export const PopoverPanel = forwardRef<HTMLDivElement, PopoverPanelProps>(function PopoverPanel(
  { open, origin, className = '', children, ...rest },
  ref,
) {
  const { mounted, state } = usePresence(open, EXIT_MS);
  const lastOpenContent = useRef(children);
  if (open) lastOpenContent.current = children;
  if (!mounted) return null;
  return (
    <div
      ref={ref}
      tabIndex={-1}
      {...rest}
      data-state={state}
      aria-hidden={state === 'closed' ? true : undefined}
      className={`glass-thin absolute z-[100] rounded-xl outline-none ${ORIGIN_CLASS[origin]} data-[state=open]:animate-popover-in data-[state=closed]:pointer-events-none data-[state=closed]:animate-popover-out ${className}`}
    >
      {open ? children : lastOpenContent.current}
    </div>
  );
});
