/**
 * useWideLayout.test.tsx – the shell breakpoint follows matchMedia: it starts
 * from the current match, flips only when the media query reports a change
 * (plain resize events do nothing) and falls back to window.innerWidth where
 * matchMedia is missing (jsdom).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWideLayout, WIDE_LAYOUT_MIN_WIDTH } from '../useWideLayout';
import { installMatchMedia, type FakeMatchMedia } from './fakeMatchMedia';

let media: FakeMatchMedia | null = null;

afterEach(() => {
  media?.uninstall();
  media = null;
});

describe('useWideLayout', () => {
  it('reports the current media query match', () => {
    media = installMatchMedia(true);
    const { result } = renderHook(() => useWideLayout());
    expect(result.current).toBe(true);
  });

  it('flips when the viewport crosses the breakpoint', () => {
    media = installMatchMedia(true);
    const { result } = renderHook(() => useWideLayout());

    media.set(false);
    expect(result.current).toBe(false);

    media.set(true);
    expect(result.current).toBe(true);
  });

  it('ignores resize events that do not cross the breakpoint', () => {
    media = installMatchMedia(false);
    const { result } = renderHook(() => useWideLayout());

    act(() => {
      window.dispatchEvent(new Event('resize'));
    });

    expect(result.current).toBe(false);
  });

  it('falls back to window.innerWidth without matchMedia', () => {
    window.innerWidth = WIDE_LAYOUT_MIN_WIDTH;
    const wide = renderHook(() => useWideLayout());
    expect(wide.result.current).toBe(true);

    window.innerWidth = WIDE_LAYOUT_MIN_WIDTH - 1;
    const narrow = renderHook(() => useWideLayout());
    expect(narrow.result.current).toBe(false);
  });
});
