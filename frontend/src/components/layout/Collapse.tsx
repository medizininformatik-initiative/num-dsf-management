/**
 * Collapse.tsx – Disclosure content that grows and shrinks with its height
 * (a one-row grid animating 0fr ↔ 1fr on the spring curve, faster on the way
 * out), mounted only while open or closing. Content that is open on mount
 * appears without animating, so a page does not unfold on load. While
 * closing it is inert to the pointer and hidden from assistive tech. Under
 * Reduce Motion the height changes at once and only the opacity fades.
 * Dependencies: usePresence, lib/motion.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { usePresence } from '../../hooks/usePresence';
import { exitMs } from '../../lib/motion';

interface CollapseProps {
  open: boolean;
  id?: string;
  className?: string;
  children: ReactNode;
}

export function Collapse({ open, id, className = '', children }: CollapseProps) {
  const { mounted, state } = usePresence(open, exitMs('medium'));
  // Animate only after the first change of `open`.
  const initialOpen = useRef(open);
  const [changed, setChanged] = useState(false);
  useEffect(() => {
    if (open !== initialOpen.current) setChanged(true);
  }, [open]);

  if (!mounted) return null;
  const motion = changed
    ? 'data-[state=open]:animate-expand-in data-[state=closed]:animate-expand-out'
    : '';
  return (
    <div
      id={id}
      data-state={state}
      aria-hidden={state === 'closed' ? true : undefined}
      className={`grid grid-rows-[1fr] data-[state=closed]:pointer-events-none ${motion}`}
    >
      <div className={`min-h-0 overflow-hidden ${className}`}>{children}</div>
    </div>
  );
}
