/**
 * helpScrollSpy.test.ts — the current TOC entry follows the reading line, falls
 * back to the first section above the first one, and is the last section at the
 * end of the page.
 */
import { describe, it, expect } from 'vitest';
import { pickActiveSection } from '../helpScrollSpy';

const sections = [
  { id: 'a', top: -300 },
  { id: 'b', top: 40 },
  { id: 'c', top: 400 },
  { id: 'd', top: 520 },
];

describe('pickActiveSection', () => {
  it('picks the last section whose top has passed the reading line', () => {
    expect(pickActiveSection(sections, 100, false)).toBe('b');
    expect(pickActiveSection(sections, 450, false)).toBe('c');
  });

  it('keeps the first section active while none has reached the line', () => {
    expect(pickActiveSection([{ id: 'a', top: 300 }], 100, false)).toBe('a');
  });

  it('picks the last section at the end of the page even if it never reaches the line', () => {
    expect(pickActiveSection(sections, 100, true)).toBe('d');
  });

  it('has no active section without sections', () => {
    expect(pickActiveSection([], 100, false)).toBeNull();
  });
});
