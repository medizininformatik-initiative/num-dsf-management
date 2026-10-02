/**
 * canvasGeometry.ts – pure geometry for the canvas overlays (RelationOverlay,
 * HighlightRing): element boxes in the scroll container's content
 * coordinates, corner radii, and the cubic Bézier of a relation line.
 * Dependencies: none.
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface RelationCurve {
  /** SVG path data of one cubic Bézier. */
  d: string;
  start: Point;
  end: Point;
}

const round = (v: number) => Math.round(v * 10) / 10;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

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

/**
 * A cubic Bézier from `source` to `target`. Side by side, it leaves and
 * enters through the facing edges with horizontal tangents. Stacked
 * (overlapping horizontally), it leaves and re-enters on the same side and
 * bulges into the free space there: on the right, or on the left when the
 * `width`-wide content has more room there. The bulge stays inside the content.
 */
export function relationCurve(source: Box, target: Box, width: number): RelationCurve {
  const y1 = source.y + source.h / 2;
  const y2 = target.y + target.h / 2;
  let x1: number;
  let x2: number;
  let c1: number;
  let c2: number;

  if (target.x >= source.x + source.w) {
    x1 = source.x + source.w;
    x2 = target.x;
    const dx = Math.max(24, (x2 - x1) / 2);
    c1 = x1 + dx;
    c2 = x2 - dx;
  } else if (target.x + target.w <= source.x) {
    x1 = source.x;
    x2 = target.x + target.w;
    const dx = Math.max(24, (x1 - x2) / 2);
    c1 = x1 - dx;
    c2 = x2 + dx;
  } else {
    const right = Math.max(source.x + source.w, target.x + target.w);
    const left = Math.min(source.x, target.x);
    const bulge = clamp(Math.abs(y2 - y1) / 4, 24, 96);
    // A cubic with both control points at c reaches 3/4 of the way to c.
    const fit = (room: number) => Math.min(bulge, Math.max(8, (room - 4) / 0.75));
    if (width - right >= left) {
      x1 = source.x + source.w;
      x2 = target.x + target.w;
      c1 = c2 = right + fit(width - right);
    } else {
      x1 = source.x;
      x2 = target.x;
      c1 = c2 = left - fit(left);
    }
  }

  const start = { x: round(x1), y: round(y1) };
  const end = { x: round(x2), y: round(y2) };
  return {
    d: `M${start.x} ${start.y} C${round(c1)} ${start.y} ${round(c2)} ${end.y} ${end.x} ${end.y}`,
    start,
    end,
  };
}
