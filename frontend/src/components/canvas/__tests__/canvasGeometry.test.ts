/**
 * canvasGeometry.test.ts — pure geometry of the canvas overlays: element
 * boxes in scroll-content coordinates, corner radii and the relation curve
 * for side-by-side and stacked source/target pairs.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { boxIn, cornerRadius, relationCurve } from '../canvasGeometry';

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('boxIn', () => {
  it('measures an element in the scroll content of its container', () => {
    const container = document.createElement('div');
    const el = document.createElement('div');
    container.appendChild(el);
    document.body.appendChild(container);
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(rect(200, 100, 600, 400));
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(rect(250, 60, 120, 30));
    // 1px border and scrolled by 80px down, 10px right.
    Object.defineProperty(container, 'clientLeft', { value: 1 });
    Object.defineProperty(container, 'clientTop', { value: 1 });
    Object.defineProperty(container, 'scrollLeft', { value: 10 });
    Object.defineProperty(container, 'scrollTop', { value: 80 });

    expect(boxIn(container, el)).toEqual({ x: 59, y: 39, w: 120, h: 30 });
  });
});

describe('relationCurve', () => {
  const source = { x: 400, y: 100, w: 200, h: 40 }; // centre y 120

  it('joins the facing edges when the target is on the left', () => {
    const target = { x: 16, y: 16, w: 300, h: 400 }; // right edge 316, centre y 216
    const curve = relationCurve(source, target, 1000);
    expect(curve.start).toEqual({ x: 400, y: 120 });
    expect(curve.end).toEqual({ x: 316, y: 216 });
    // Horizontal tangents: the control points share the end points' heights.
    expect(curve.d).toBe('M400 120 C358 120 358 216 316 216');
  });

  it('keeps a minimum swing between edges that nearly touch', () => {
    const target = { x: 610, y: 100, w: 100, h: 40 };
    expect(relationCurve(source, target, 1000).d).toBe('M600 120 C624 120 586 120 610 120');
  });

  it('bulges into the free space on the right when the boxes are stacked', () => {
    const target = { x: 380, y: 400, w: 260, h: 40 }; // right edge 640, centre y 420
    const curve = relationCurve(source, target, 1200);
    expect(curve.start).toEqual({ x: 600, y: 120 });
    expect(curve.end).toEqual({ x: 640, y: 420 });
    // Bulge: a quarter of the 300px rise, capped at 96 → 75px past the right edge.
    expect(curve.d).toBe('M600 120 C715 120 715 420 640 420');
  });

  it('bulges left when there is more room there, and stays inside the content', () => {
    const wide = { x: 600, y: 100, w: 380, h: 40 };
    const below = { x: 620, y: 400, w: 370, h: 40 };
    const curve = relationCurve(wide, below, 1000);
    expect(curve.start).toEqual({ x: 600, y: 120 });
    expect(curve.end).toEqual({ x: 620, y: 420 });
    expect(curve.d).toBe('M600 120 C525 120 525 420 620 420');

    // With only 10px of room on either side, the bulge shrinks to fit.
    const tight = relationCurve({ x: 10, y: 100, w: 970, h: 40 }, below, 1000);
    const control = Number(tight.d.split(' ')[2].slice(1));
    expect(control).toBeGreaterThan(990);
    expect(990 + (control - 990) * 0.75).toBeLessThanOrEqual(1000);
  });
});

describe('cornerRadius', () => {
  it('reads the corner radius in px, and 0 without one', () => {
    const rounded = document.createElement('div');
    rounded.style.borderRadius = '12px';
    const square = document.createElement('div');
    document.body.append(rounded, square);
    expect(cornerRadius(rounded)).toBe(12);
    expect(cornerRadius(square)).toBe(0);
  });
});
