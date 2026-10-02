/**
 * useWideLayout.ts – whether the app shell uses its wide layout (>= 1200 px):
 * persistent sidebar and status columns there, rails that open modal drawers
 * below it. It follows a matchMedia listener, so it changes only when the
 * viewport crosses the breakpoint, never on other resize events. Without
 * matchMedia (jsdom) it falls back to window.innerWidth.
 * Dependencies: react.
 */
import { useSyncExternalStore } from 'react';

export const WIDE_LAYOUT_MIN_WIDTH = 1200;

const QUERY = `(min-width: ${WIDE_LAYOUT_MIN_WIDTH}px)`;

function hasMatchMedia(): boolean {
  return typeof window.matchMedia === 'function';
}

function subscribe(onChange: () => void): () => void {
  if (!hasMatchMedia()) return () => {};
  const query = window.matchMedia(QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function getSnapshot(): boolean {
  return hasMatchMedia()
    ? window.matchMedia(QUERY).matches
    : window.innerWidth >= WIDE_LAYOUT_MIN_WIDTH;
}

export function useWideLayout(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot);
}
