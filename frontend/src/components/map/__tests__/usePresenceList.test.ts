import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePresenceList } from '../usePresenceList';

const key = (s: string) => s;

afterEach(() => {
  vi.useRealTimers();
});

describe('usePresenceList', () => {
  it('keeps a removed item as leaving for the exit duration, then drops it', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ items }) => usePresenceList(items, key, 100), {
      initialProps: { items: ['a', 'b'] },
    });
    expect(result.current).toEqual([
      { item: 'a', key: 'a', leaving: false },
      { item: 'b', key: 'b', leaving: false },
    ]);

    rerender({ items: ['a'] });
    // No frame without the removed item: it is leaving straight away.
    expect(result.current).toEqual([
      { item: 'a', key: 'a', leaving: false },
      { item: 'b', key: 'b', leaving: true },
    ]);

    act(() => vi.advanceTimersByTime(100));
    expect(result.current).toEqual([{ item: 'a', key: 'a', leaving: false }]);
  });

  it('revives an item that returns while leaving', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ items }) => usePresenceList(items, key, 100), {
      initialProps: { items: ['a', 'b'] },
    });
    rerender({ items: ['a'] });
    rerender({ items: ['a', 'b'] });
    expect(result.current.filter((p) => p.key === 'b')).toEqual([
      { item: 'b', key: 'b', leaving: false },
    ]);
  });

  it('removes at once without an exit duration', () => {
    const { result, rerender } = renderHook(({ items }) => usePresenceList(items, key, 0), {
      initialProps: { items: ['a', 'b'] },
    });
    rerender({ items: ['a'] });
    expect(result.current).toEqual([{ item: 'a', key: 'a', leaving: false }]);
  });
});
