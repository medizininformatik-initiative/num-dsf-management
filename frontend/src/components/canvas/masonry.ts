/**
 * masonry.ts – dependency-free masonry for the canvas grid. The grid has tiny
 * implicit rows (`grid-auto-rows`, ROW_UNIT) and no row gap; every cell spans
 * as many of them as its content needs plus the gap below it, so cards pack
 * upward with the same gap in every column while the DOM order (reading and
 * tab order) stays untouched. `useMasonryGrid` measures each cell with a
 * ResizeObserver and writes `grid-row-end` straight onto the element, so a
 * growing card relayouts in the same frame without re-rendering React.
 * Dependencies: react.
 */
import { useLayoutEffect, type RefObject } from 'react';

/** Height of one implicit grid row in px; must match `grid-auto-rows` in entity-canvas.css. */
export const ROW_UNIT = 2;

/** Number of implicit rows a cell of `height` px plus a `gap` px below it spans (at least 1). */
export function masonrySpan(height: number, gap: number, rowUnit: number = ROW_UNIT): number {
  if (!(rowUnit > 0)) return 1;
  const total = Math.max(0, height) + Math.max(0, gap);
  return Math.max(1, Math.ceil(total / rowUnit));
}

function pixels(value: string, fallback: number): number {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Keeps the `cellSelector` children of the grid in `gridRef` spanning the rows
 * their content needs. The vertical gap comes from `--canvas-gap` on the grid
 * (resolved to px through a probe-free computed `column-gap`, which uses the
 * same value), the row unit from `grid-auto-rows`.
 */
export function useMasonryGrid(gridRef: RefObject<HTMLElement>, cellSelector: string): void {
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;

    function layout() {
      const style = getComputedStyle(grid!);
      const gap = pixels(style.columnGap, 0);
      const unit = pixels(style.gridAutoRows, ROW_UNIT);
      grid!.querySelectorAll<HTMLElement>(`:scope > ${cellSelector}`).forEach((cell) => {
        const span = `span ${masonrySpan(cell.getBoundingClientRect().height, gap, unit)}`;
        if (cell.style.gridRowEnd !== span) cell.style.gridRowEnd = span;
      });
    }

    layout();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', layout);
      return () => window.removeEventListener('resize', layout);
    }
    let frame = 0;
    const observer = new ResizeObserver(() => {
      // Spans written inside the callback may resize cells again (column count
      // changes the width, which changes the height); settle within the frame.
      cancelAnimationFrame(frame);
      layout();
      frame = requestAnimationFrame(layout);
    });
    observer.observe(grid);
    grid.querySelectorAll(`:scope > ${cellSelector}`).forEach((cell) => observer.observe(cell));
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [gridRef, cellSelector]);
}
