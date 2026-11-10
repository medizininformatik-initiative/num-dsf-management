import { describe, it, expect } from 'vitest';
import { isStepUpCodeComplete, sanitizeTan } from '../stepUpCode';

describe('isStepUpCodeComplete', () => {
  it('accepts a 6-digit code and an 8-character TAN', () => {
    expect(isStepUpCodeComplete('123456')).toBe(true);
    expect(isStepUpCodeComplete('A1B2C3D4')).toBe(true);
    expect(isStepUpCodeComplete('a1b2c3d4')).toBe(true);
  });

  it('refuses incomplete or malformed input', () => {
    expect(isStepUpCodeComplete('')).toBe(false);
    expect(isStepUpCodeComplete('12345')).toBe(false);
    expect(isStepUpCodeComplete('1234567')).toBe(false);
    expect(isStepUpCodeComplete('A1B2C3D')).toBe(false);
    expect(isStepUpCodeComplete('A1B2C3DZ')).toBe(false);
  });
});

describe('sanitizeTan', () => {
  it('keeps hex characters, upper-cases and caps at 8', () => {
    expect(sanitizeTan('a1b2-c3d4')).toBe('A1B2C3D4');
    expect(sanitizeTan('a1b2 c3d4 ffff')).toBe('A1B2C3D4');
    expect(sanitizeTan('xyz!12')).toBe('12');
  });
});
