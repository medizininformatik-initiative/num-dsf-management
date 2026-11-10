/**
 * useNow.test.tsx — useNow returns the current time and advances it on its
 * interval; the interval is cleared on unmount.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNow } from '../useNow';

afterEach(() => {
  vi.useRealTimers();
});

describe('useNow', () => {
  it('advances on its interval', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-10T12:00:00Z'));
    const { result } = renderHook(() => useNow(1000));
    expect(result.current).toBe(Date.parse('2026-11-10T12:00:00Z'));

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(Date.parse('2026-11-10T12:00:01Z'));
  });

  it('clears its interval on unmount', () => {
    vi.useFakeTimers();
    const clear = vi.spyOn(window, 'clearInterval');
    const { unmount } = renderHook(() => useNow());
    unmount();
    expect(clear).toHaveBeenCalled();
  });
});
