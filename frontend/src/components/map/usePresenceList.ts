/**
 * usePresenceList.ts – usePresence for lists: items that drop out of `items`
 * stay rendered (flagged `leaving`) for `exitMs`, so map markers and edges can
 * play an exit animation instead of popping away when a filter or selection
 * changes. Leaving items are derived during render, so there is no frame in
 * which a removed item disappears before its exit starts. An item that comes
 * back while leaving is live again at once. Timer-based like usePresence, so
 * it never waits on animation events (reduced motion, jsdom).
 * Dependencies: react.
 */
import { useEffect, useState } from 'react';

export interface PresentItem<T> {
  item: T;
  key: string;
  leaving: boolean;
}

export function usePresenceList<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  exitMs: number,
): PresentItem<T>[] {
  const [prevItems, setPrevItems] = useState(items);
  const [leaving, setLeaving] = useState<ReadonlyMap<string, T>>(() => new Map());

  let currentLeaving = leaving;
  if (items !== prevItems) {
    const live = new Set(items.map(keyOf));
    const next = new Map(leaving);
    for (const p of prevItems) {
      const k = keyOf(p);
      if (!live.has(k) && exitMs > 0) next.set(k, p);
    }
    for (const k of live) next.delete(k);
    currentLeaving = next;
    setPrevItems(items);
    setLeaving(next);
  }

  useEffect(() => {
    if (leaving.size === 0) return;
    const timer = setTimeout(() => setLeaving(new Map()), exitMs);
    return () => clearTimeout(timer);
  }, [leaving, exitMs]);

  const out: PresentItem<T>[] = items.map((item) => ({ item, key: keyOf(item), leaving: false }));
  for (const [key, item] of currentLeaving) out.push({ item, key, leaving: true });
  return out;
}
