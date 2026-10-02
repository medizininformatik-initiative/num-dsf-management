/**
 * canvasGeometry.test.ts — pure geometry of the canvas overlays: element
 * boxes in scroll-content coordinates and corner radii.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { boxIn, cornerRadius } from '../canvasGeometry';

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
