/**
 * hoverStore.ts – The hovered (or keyboard-focused) map node, shared by the
 * map and the organization list without living in React state. A hover
 * change only re-renders the components that read it: a marker or list row
 * re-renders when its own hover flag flips (useIsHovered), and the few
 * hover-driven layers (tooltip, hover edges) read the id (useHoveredId).
 * Dependencies: react.
 */
import { useState, useSyncExternalStore } from 'react';

export interface HoverStore {
  get: () => string | null;
  set: (id: string | null) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createHoverStore(): HoverStore {
  let current: string | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set: (id) => {
      if (id === current) return;
      current = id;
      listeners.forEach((l) => l());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** A store owned by the calling component for its lifetime. */
export function useOwnHoverStore(): HoverStore {
  return useState(createHoverStore)[0];
}

export function useHoveredId(store: HoverStore): string | null {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/** True while `id` is the hovered node; re-renders only when that flips. */
export function useIsHovered(store: HoverStore | undefined, id: string): boolean {
  const read = () => (store ? store.get() === id : false);
  return useSyncExternalStore(store ? store.subscribe : noopSubscribe, read, read);
}

function noopSubscribe(): () => void {
  return () => {};
}
