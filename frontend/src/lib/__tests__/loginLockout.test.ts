/**
 * loginLockout.test.ts — the site-lockout rule: certificates exist, none is for login and no
 * non-approval login entry remains.
 */
import { describe, it, expect } from 'vitest';
import { wouldLoseCertificateLogin } from '../loginLockout';

const off = { useForLogin: false };
const on = { useForLogin: true };

describe('wouldLoseCertificateLogin', () => {
  it('warns when no certificate is for login and only approval entries exist', () => {
    expect(wouldLoseCertificateLogin([off], [])).toBe(true);
    expect(wouldLoseCertificateLogin([off, off], [{ source: 'APPROVAL' }])).toBe(true);
  });

  it('does not warn while another login entry exists', () => {
    for (const source of ['ONBOARDING', 'ADMIN', 'MIGRATED'] as const) {
      expect(wouldLoseCertificateLogin([off], [{ source }])).toBe(false);
    }
  });

  it('does not warn when a certificate is for login (or the flag is missing)', () => {
    expect(wouldLoseCertificateLogin([off, on], [])).toBe(false);
    expect(wouldLoseCertificateLogin([{}], [])).toBe(false);
  });

  it('does not warn without certificates or while the login entries are unknown', () => {
    expect(wouldLoseCertificateLogin([], [])).toBe(false);
    expect(wouldLoseCertificateLogin([off], undefined)).toBe(false);
  });
});
