/**
 * useCountUp.test.ts — the count-up and grow-in hooks return the final state
 * at once without matchMedia (jsdom) and under prefers-reduced-motion.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCountUp, useGrowIn } from '../useCountUp';

function stubMatchMedia(matches: boolean): void {
  window.matchMedia = vi.fn().mockReturnValue({ matches }) as unknown as typeof window.matchMedia;
}

describe('useCountUp / useGrowIn', () => {
  afterEach(() => {
    // jsdom has no matchMedia of its own; remove the stub again.
    Reflect.deleteProperty(window, 'matchMedia');
  });

  it('returns the value directly when matchMedia is unavailable', () => {
    expect(renderHook(() => useCountUp(42)).result.current).toBe(42);
    expect(renderHook(() => useGrowIn()).result.current).toBe(true);
  });

  it('returns the value directly under prefers-reduced-motion', () => {
    stubMatchMedia(true);
    expect(renderHook(() => useCountUp(7)).result.current).toBe(7);
    expect(renderHook(() => useGrowIn()).result.current).toBe(true);
  });

  it('starts at 0 when motion is allowed', () => {
    stubMatchMedia(false);
    expect(renderHook(() => useCountUp(7)).result.current).toBe(0);
    expect(renderHook(() => useGrowIn()).result.current).toBe(false);
  });
});
