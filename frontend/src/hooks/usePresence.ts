/**
 * usePresence.ts – keeps an element mounted while its exit animation plays.
 *
 *   const { mounted, state } = usePresence(open, exitMs('medium'));
 *   if (!mounted) return null;
 *   return (
 *     <div
 *       data-state={state}
 *       className="data-[state=open]:animate-scale-in data-[state=closed]:animate-scale-out"
 *     />
 *   );
 *
 * Opening mounts at once with state 'open'. Closing switches state to
 * 'closed' in the same render (so the exit animation starts) and unmounts
 * after exitMs; reopening meanwhile cancels the unmount. exitMs <= 0 unmounts
 * immediately. It is timer-based, so it never waits on animation events that
 * may not fire (reduced motion, jsdom). Dependencies: react.
 */
import { useEffect, useState } from 'react';

export type PresenceState = 'open' | 'closed';

export interface Presence {
  /** Render the element while true. */
  mounted: boolean;
  /** Set as data-state on the element to drive its enter/exit animation. */
  state: PresenceState;
}

export function usePresence(open: boolean, exitMs: number): Presence {
  const [present, setPresent] = useState(open);

  useEffect(() => {
    if (open || exitMs <= 0) {
      setPresent(open);
      return;
    }
    const timer = setTimeout(() => setPresent(false), exitMs);
    return () => clearTimeout(timer);
  }, [open, exitMs]);

  return { mounted: open || (present && exitMs > 0), state: open ? 'open' : 'closed' };
}
