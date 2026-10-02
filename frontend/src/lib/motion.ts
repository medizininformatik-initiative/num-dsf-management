/**
 * motion.ts – JS side of the motion system: millisecond mirrors of the CSS
 * duration tokens in src/index.css (for timers such as usePresence) and
 * reduced-motion helpers for script-driven motion. Dependencies: none.
 */

/** Entrance durations in ms; mirrors --duration-* in src/index.css. */
export const MOTION_MS = { micro: 120, short: 200, medium: 320, long: 450 } as const;

export type MotionDuration = keyof typeof MOTION_MS;

/** Exit duration in ms (~70% of the entrance); mirrors --duration-*-exit. */
export function exitMs(duration: MotionDuration): number {
  return Math.round(MOTION_MS[duration] * 0.7);
}

/** True when the user asked the OS to reduce motion. Safe outside a browser. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Element.scrollIntoView that honours Reduce Motion: smooth unless the caller
 * passes another behavior, and always instant ('auto') when the user prefers
 * reduced motion. Does nothing for a missing element.
 */
export function scrollIntoViewSafe(
  el: Element | null | undefined,
  opts: ScrollIntoViewOptions = {},
): void {
  if (!el || typeof el.scrollIntoView !== 'function') return;
  el.scrollIntoView({
    ...opts,
    behavior: prefersReducedMotion() ? 'auto' : (opts.behavior ?? 'smooth'),
  });
}
