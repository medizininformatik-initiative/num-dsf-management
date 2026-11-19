/**
 * useCountUp.ts – small motion hooks for the admin overview charts:
 * useCountUp counts a number up from 0 (ease-out), useGrowIn flips to true one
 * frame after mount so CSS transitions can grow bars from 0 to their value.
 * Without window.matchMedia (jsdom) or under prefers-reduced-motion both
 * return the final state immediately.
 *
 * Dependencies: react, lib/motion (prefersReducedMotion)
 */
import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from './motion';

/** Motion is only played when matchMedia exists and reduced motion is off. */
function motionEnabled(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    !prefersReducedMotion()
  );
}

const easeOut = (x: number): number => 1 - Math.pow(1 - x, 3);

/** Counts from 0 (and on later changes from the shown value) to `value`. */
export function useCountUp(value: number, durationMs = 600): number {
  // A zero or negative duration has nothing to animate (and would divide by 0).
  const enabled = motionEnabled() && durationMs > 0;
  const [display, setDisplay] = useState(enabled ? 0 : value);
  const shown = useRef(display);

  useEffect(() => {
    if (!enabled) return;
    const from = shown.current;
    const start = performance.now();
    let raf = requestAnimationFrame(function step(now: number) {
      const p = Math.min(1, Math.max(0, (now - start) / durationMs));
      shown.current = Math.round(from + (value - from) * easeOut(p));
      setDisplay(shown.current);
      if (p < 1) raf = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(raf);
  }, [value, durationMs, enabled]);

  return enabled ? display : value;
}

/** False on the first paint, true afterwards; always true without motion. */
export function useGrowIn(): boolean {
  const [ready, setReady] = useState(!motionEnabled());
  useEffect(() => {
    if (ready) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setReady(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [ready]);
  return ready;
}
