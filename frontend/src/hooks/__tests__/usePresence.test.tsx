/**
 * usePresence.test.tsx — the mount/exit lifecycle behind every animated
 * overlay: opening mounts at once, closing flips data-state to 'closed' while
 * the element stays mounted for exitMs, then it unmounts. Reopening during the
 * exit cancels the unmount, and exitMs <= 0 unmounts immediately. Fake timers
 * drive the exit delay.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePresence } from '../usePresence';

const EXIT_MS = 224;

function setup(open: boolean, exitMs = EXIT_MS) {
  return renderHook(({ open, exitMs }) => usePresence(open, exitMs), {
    initialProps: { open, exitMs },
  });
}

describe('usePresence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stays unmounted while closed', () => {
    const { result } = setup(false);
    expect(result.current).toEqual({ mounted: false, state: 'closed' });
  });

  it('mounts in the open state as soon as it opens', () => {
    const { result, rerender } = setup(false);
    rerender({ open: true, exitMs: EXIT_MS });
    expect(result.current).toEqual({ mounted: true, state: 'open' });
  });

  it('switches to the closed state on close and unmounts after exitMs', () => {
    const { result, rerender } = setup(true);
    expect(result.current).toEqual({ mounted: true, state: 'open' });

    rerender({ open: false, exitMs: EXIT_MS });
    expect(result.current).toEqual({ mounted: true, state: 'closed' });

    act(() => {
      vi.advanceTimersByTime(EXIT_MS - 1);
    });
    expect(result.current.mounted).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toEqual({ mounted: false, state: 'closed' });
  });

  it('cancels the unmount when reopened during the exit', () => {
    const { result, rerender } = setup(true);
    rerender({ open: false, exitMs: EXIT_MS });
    act(() => {
      vi.advanceTimersByTime(EXIT_MS / 2);
    });

    rerender({ open: true, exitMs: EXIT_MS });
    act(() => {
      vi.advanceTimersByTime(EXIT_MS * 2);
    });
    expect(result.current).toEqual({ mounted: true, state: 'open' });
  });

  it('unmounts immediately when there is no exit animation', () => {
    const { result, rerender } = setup(true, 0);
    rerender({ open: false, exitMs: 0 });
    expect(result.current).toEqual({ mounted: false, state: 'closed' });
  });
});
