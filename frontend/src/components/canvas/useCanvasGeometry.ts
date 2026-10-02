/**
 * useCanvasGeometry.ts – measures what a canvas overlay draws while `key` is
 * set: immediately, then again on container scroll, window resize and layout
 * changes (a ResizeObserver on the container, its children and the elements
 * `compute` reports), at most once per animation frame. No polling, and no
 * listeners at all while `key` is null. Without ResizeObserver (jsdom) only
 * scroll and resize re-measure. Dependencies: react.
 */
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

export interface Measured<G> {
  geometry: G;
  /** Elements whose size changes should trigger a new measurement. */
  elements: Element[];
}

export function useCanvasGeometry<G>(
  containerRef: RefObject<HTMLElement>,
  key: string | null,
  compute: (container: HTMLElement) => Measured<G> | null,
): G | null {
  const [geometry, setGeometry] = useState<G | null>(null);
  const computeRef = useRef(compute);
  useLayoutEffect(() => {
    computeRef.current = compute;
  });

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (key === null || !container) {
      setGeometry(null);
      return;
    }
    let frame = 0;
    const observed = new Set<Element>();
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => schedule());

    function observe(el: Element) {
      if (!observer || observed.has(el)) return;
      observed.add(el);
      observer.observe(el);
    }
    function measure() {
      frame = 0;
      const result = computeRef.current(container!);
      setGeometry(result ? result.geometry : null);
      result?.elements.forEach(observe);
    }
    function schedule() {
      if (!frame) frame = requestAnimationFrame(measure);
    }

    observe(container);
    Array.from(container.children).forEach(observe);
    measure();
    container.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      container.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      observer?.disconnect();
    };
  }, [containerRef, key]);

  return key === null ? null : geometry;
}
