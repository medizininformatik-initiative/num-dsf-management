/**
 * useCountUp.test.ts — the count-up and grow-in hooks return the final state
 * at once without matchMedia (jsdom) and under prefers-reduced-motion.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
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

  it('shows the value directly for a zero or negative duration', () => {
    stubMatchMedia(false);
    expect(renderHook(() => useCountUp(7, 0)).result.current).toBe(7);
    expect(renderHook(() => useCountUp(7, -5)).result.current).toBe(7);
  });

  it('never goes below the start when the frame time precedes the start', () => {
    stubMatchMedia(false);
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    let frame: FrameRequestCallback = () => {};
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      frame = cb;
      return 1;
    });
    const { result } = renderHook(() => useCountUp(10, 600));
    act(() => frame(900)); // elapsed -100 ms
    expect(result.current).toBe(0);
    act(() => frame(1000 + 10_000)); // far past the end
    expect(result.current).toBe(10);
    vi.restoreAllMocks();
  });
});
