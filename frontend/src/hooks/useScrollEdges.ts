/**
 * useScrollEdges.ts – iOS-style scroll edge fades. Returns a callback ref for
 * a scroll container; it sets data-edge-top / data-edge-bottom on the element
 * while there is more content above / below, and useScrollEdges.css turns
 * those into a mask gradient. Updated by a passive scroll listener and a
 * ResizeObserver (container and content size); no React state, no re-renders.
 * Dependencies: ./useScrollEdges.css (imported for its side effect).
 */
import { useCallback, useRef } from 'react';
import './useScrollEdges.css';

const THRESHOLD_PX = 1;

export function updateScrollEdges(el: HTMLElement): void {
  const { scrollTop, scrollHeight, clientHeight } = el;
  const top = scrollTop > THRESHOLD_PX;
  const bottom = scrollHeight - clientHeight - scrollTop > THRESHOLD_PX;
  el.toggleAttribute('data-edge-top', top);
  el.toggleAttribute('data-edge-bottom', bottom);
}

export function useScrollEdges<T extends HTMLElement = HTMLDivElement>(): (el: T | null) => void {
  const cleanup = useRef<(() => void) | null>(null);
  return useCallback((el: T | null) => {
    cleanup.current?.();
    cleanup.current = null;
    if (!el) return;
    const update = () => updateScrollEdges(el);
    update();
    el.addEventListener('scroll', update, { passive: true });
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(update);
      observer.observe(el);
      Array.from(el.children).forEach((child) => observer?.observe(child));
    }
    cleanup.current = () => {
      el.removeEventListener('scroll', update);
      observer?.disconnect();
    };
  }, []);
}
