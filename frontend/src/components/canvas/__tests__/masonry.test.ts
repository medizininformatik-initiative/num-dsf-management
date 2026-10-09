import { describe, it, expect } from 'vitest';
import { masonrySpan, ROW_UNIT } from '../masonry';

describe('masonrySpan', () => {
  it('spans the card height plus the gap below it in row units, rounded up', () => {
    expect(masonrySpan(200, 16, 4)).toBe(54);
    expect(masonrySpan(201, 16, 4)).toBe(55);
    expect(masonrySpan(100, 0, 2)).toBe(50);
  });

  it('uses the shared row unit by default', () => {
    expect(masonrySpan(100, 16)).toBe(Math.ceil(116 / ROW_UNIT));
  });

  it('never returns less than one row and ignores negative input', () => {
    expect(masonrySpan(0, 0)).toBe(1);
    expect(masonrySpan(-50, -10, 4)).toBe(1);
  });

  it('falls back to one row for an invalid row unit', () => {
    expect(masonrySpan(100, 16, 0)).toBe(1);
    expect(masonrySpan(100, 16, Number.NaN)).toBe(1);
  });

  it('gives cards in different columns the same gap below them', () => {
    // After rounding up, the remaining gap is within one row unit of the target.
    for (const h of [123, 301, 457.5]) {
      const span = masonrySpan(h, 16, 2);
      const gap = span * 2 - h;
      expect(gap).toBeGreaterThanOrEqual(16);
      expect(gap).toBeLessThan(16 + 2);
    }
  });
});
