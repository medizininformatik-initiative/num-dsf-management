// Purpose: stepUpCode treats an empty step-up code as absent and keeps the length bounds
// Dependencies: schemas/stepUpCode
import { stepUpCode } from '../schemas/stepUpCode';

describe('stepUpCode', () => {
  it('treats empty and whitespace-only strings as absent', () => {
    expect(stepUpCode.parse('')).toBeUndefined();
    expect(stepUpCode.parse('   ')).toBeUndefined();
    expect(stepUpCode.parse(undefined)).toBeUndefined();
  });
  it('rejects codes shorter than 6 or longer than 10 characters', () => {
    expect(stepUpCode.safeParse('12345').success).toBe(false);
    expect(stepUpCode.safeParse('12345678901').success).toBe(false);
  });
  it('accepts a 6-digit code and a spaced TAN of up to 10 characters', () => {
    expect(stepUpCode.parse('123456')).toBe('123456');
    expect(stepUpCode.parse('ab12 cd34')).toBe('ab12 cd34');
  });
});
