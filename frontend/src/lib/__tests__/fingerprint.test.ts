/**
 * fingerprint.test.ts — fingerprint normalization (OpenSSL colon form, case)
 * and grouping for display.
 */
import { describe, it, expect } from 'vitest';
import { fingerprintGroups, normalizeFingerprint } from '../fingerprint';

describe('normalizeFingerprint', () => {
  it('turns OpenSSL colon output into raw lower-case hex', () => {
    expect(normalizeFingerprint('EA:5A:0A:74')).toBe('ea5a0a74');
    expect(normalizeFingerprint(' ea5a 0a74 \n')).toBe('ea5a0a74');
  });
});

describe('fingerprintGroups', () => {
  it('splits a 128-character DSF thumbprint into 32 groups of 4', () => {
    const groups = fingerprintGroups('ab'.repeat(64));
    expect(groups).toHaveLength(32);
    expect(groups.every((g) => g === 'abab')).toBe(true);
  });

  it('keeps a shorter last group and supports other sizes', () => {
    expect(fingerprintGroups('abcdef', 4)).toEqual(['abcd', 'ef']);
    expect(fingerprintGroups('AB:CD:EF', 2)).toEqual(['ab', 'cd', 'ef']);
  });
});
