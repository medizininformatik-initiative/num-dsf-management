/**
 * authMotion.ts – Shared motion state of the sign-in screens. Each auth route
 * mounts its own AuthLayout, so the continuity between steps lives here at
 * module level: the ambient background's time base (no restart on a route
 * change), whether the brand intro has played, and the last step index and
 * card height (the next step slides in reading direction and the card grows
 * or shrinks from the previous height instead of popping in again).
 * Also the wrong-code shake (Web Animations API, skipped under Reduce Motion)
 * and how long the success check stays before the redirect.
 * Dependencies: lib/motion.
 */
import { prefersReducedMotion } from '../../lib/motion';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

let ambientStart = now();
let brandIntroPlayed = false;
let lastStep: number | null = null;
let lastHeight: number | null = null;

/** Seconds since the first auth screen mounted; drives a negative animation-delay. */
export function ambientElapsedS(): number {
  return Math.round((now() - ambientStart) / 100) / 10;
}

export function brandIntroPending(): boolean {
  return !brandIntroPlayed;
}
export function markBrandIntroPlayed(): void {
  brandIntroPlayed = true;
}

export type StepDirection = 'intro' | 'forward' | 'back';

/** Direction for a freshly mounted card: intro on the very first card. */
export function directionFor(step: number): StepDirection {
  if (lastStep === null) return 'intro';
  return step >= lastStep ? 'forward' : 'back';
}
export function rememberStep(step: number): void {
  lastStep = step;
}

export function previousCardHeight(): number | undefined {
  return lastStep === null || lastHeight === null ? undefined : lastHeight;
}
export function rememberCardHeight(height: number): void {
  lastHeight = height;
}

/** Test helper: forget all continuity so each test starts with the intro. */
export function resetAuthMotion(): void {
  ambientStart = now();
  brandIntroPlayed = false;
  lastStep = null;
  lastHeight = null;
}

/** How long the success check is shown before the redirect, in ms. */
export function successHoldMs(): number {
  return prefersReducedMotion() ? 400 : 900;
}

const SHAKE: Keyframe[] = [
  { transform: 'translateX(0)' },
  { transform: 'translateX(-7px)' },
  { transform: 'translateX(6px)' },
  { transform: 'translateX(-4px)' },
  { transform: 'translateX(2px)' },
  { transform: 'translateX(0)' },
];

/** A gentle horizontal shake for a rejected code; no-op under Reduce Motion. */
export function shakeElement(el: HTMLElement | null): void {
  if (!el || typeof el.animate !== 'function' || prefersReducedMotion()) return;
  el.animate(SHAKE, { duration: 420, easing: 'cubic-bezier(0.36, 0.07, 0.19, 0.97)' });
}
