/**
 * motion.test.ts — the JS mirrors of the motion tokens and the reduced-motion
 * helpers. jsdom has neither matchMedia nor scrollIntoView, so both are stubbed
 * per test: prefersReducedMotion must tolerate the missing API, and
 * scrollIntoViewSafe must switch smooth scrolling to 'auto' under Reduce Motion.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { MOTION_MS, exitMs, prefersReducedMotion, scrollIntoViewSafe } from '../motion';

function stubReducedMotion(matches: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({ matches: matches && query.includes('reduce'), media: query })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('motion tokens', () => {
  it('mirrors the CSS durations and derives exits at ~70%', () => {
    expect(MOTION_MS).toEqual({ micro: 120, short: 200, medium: 320, long: 450 });
    expect(exitMs('short')).toBe(140);
    expect(exitMs('medium')).toBe(224);
    expect(exitMs('long')).toBe(315);
  });
});

describe('prefersReducedMotion', () => {
  it('is false when matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(prefersReducedMotion()).toBe(false);
  });

  it('follows the prefers-reduced-motion media query', () => {
    stubReducedMotion(true);
    expect(prefersReducedMotion()).toBe(true);
    stubReducedMotion(false);
    expect(prefersReducedMotion()).toBe(false);
  });
});

describe('scrollIntoViewSafe', () => {
  function element() {
    const el = document.createElement('div');
    const scrollIntoView = vi.fn();
    Object.defineProperty(el, 'scrollIntoView', { value: scrollIntoView });
    return { el, scrollIntoView };
  }

  it('scrolls smoothly by default and keeps the other options', () => {
    stubReducedMotion(false);
    const { el, scrollIntoView } = element();
    scrollIntoViewSafe(el, { block: 'nearest' });
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' });
  });

  it('scrolls instantly under Reduce Motion even when smooth was requested', () => {
    stubReducedMotion(true);
    const { el, scrollIntoView } = element();
    scrollIntoViewSafe(el, { behavior: 'smooth', block: 'center' });
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'center' });
  });

  it('ignores a missing element or a missing scrollIntoView', () => {
    expect(() => scrollIntoViewSafe(null)).not.toThrow();
    expect(() => scrollIntoViewSafe(document.createElement('div'))).not.toThrow();
  });
});
