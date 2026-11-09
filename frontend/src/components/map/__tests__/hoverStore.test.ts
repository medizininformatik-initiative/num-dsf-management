/**
 * hoverStore.test.ts – Unit tests for the shared map hover store and its hooks
 */
import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { createHoverStore, useHoveredId, useIsHovered } from '../hoverStore';

describe('createHoverStore', () => {
  it('notifies subscribers on change only', () => {
    const store = createHoverStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.set('a');
    store.set('a');
    store.set(null);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    store.set('b');
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.get()).toBe('b');
  });
});

describe('useIsHovered', () => {
  it('re-renders only the node whose hover flag flips', () => {
    const store = createHoverStore();
    let rendersA = 0;
    let rendersB = 0;
    const a = renderHook(() => {
      rendersA++;
      return useIsHovered(store, 'a');
    });
    const b = renderHook(() => {
      rendersB++;
      return useIsHovered(store, 'b');
    });
    const before = [rendersA, rendersB];
    act(() => store.set('a'));
    expect(a.result.current).toBe(true);
    expect(b.result.current).toBe(false);
    expect(rendersA).toBe(before[0] + 1);
    expect(rendersB).toBe(before[1]);
  });

  it('is false without a store', () => {
    const { result } = renderHook(() => useIsHovered(undefined, 'a'));
    expect(result.current).toBe(false);
  });
});

describe('useHoveredId', () => {
  it('follows the hovered id', () => {
    const store = createHoverStore();
    const { result } = renderHook(() => useHoveredId(store));
    expect(result.current).toBeNull();
    act(() => store.set('x'));
    expect(result.current).toBe('x');
  });
});
