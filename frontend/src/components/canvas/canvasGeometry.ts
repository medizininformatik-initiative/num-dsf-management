/**
 * canvasGeometry.ts – pure geometry for the canvas overlays (HighlightRing):
 * element boxes in the scroll container's content coordinates and corner
 * radii. Dependencies: none.
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The border box of `el` in the coordinates of `container`'s scrollable
 * content, the space its absolutely positioned children are laid out in.
 */
export function boxIn(container: HTMLElement, el: Element): Box {
  const c = container.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return {
    x: r.left - c.left - container.clientLeft + container.scrollLeft,
    y: r.top - c.top - container.clientTop + container.scrollTop,
    w: r.width,
    h: r.height,
  };
}

/** The top-left corner radius of `el` in px, 0 when it has none. */
export function cornerRadius(el: Element): number {
  const style = getComputedStyle(el);
  const radius = parseFloat(style.borderTopLeftRadius || style.borderRadius);
  return Number.isFinite(radius) ? radius : 0;
}
