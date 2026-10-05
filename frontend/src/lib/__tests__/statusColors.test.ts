/**
 * statusColors.test.ts — locks the certificate-status → tone mapping. The map
 * pins, clusters, filters and detail panel all colour certificate states
 * through it, so an accidental edit should fail a test, not silently recolor
 * the UI.
 */
import { describe, it, expect } from 'vitest';
import { CERT_STATUS_TONE, certStatusColor, TONE_CLASS } from '../statusColors';

describe('CERT_STATUS_TONE', () => {
  it('maps each certificate status to its shared tone', () => {
    expect(CERT_STATUS_TONE).toEqual({
      VALID: 'success',
      EXPIRING: 'warning',
      EXPIRED: 'danger',
      NONE: 'neutral',
    });
  });

  it('uses a distinct tone for every status', () => {
    const values = Object.values(CERT_STATUS_TONE);
    expect(new Set(values).size).toBe(values.length);
  });

  it('only uses tones that have Tailwind classes', () => {
    for (const tone of Object.values(CERT_STATUS_TONE)) expect(TONE_CLASS[tone]).toBeTruthy();
  });
});

describe('certStatusColor', () => {
  it('resolves to the tone foreground custom property', () => {
    expect(certStatusColor('VALID')).toBe('var(--tone-success-fg)');
    expect(certStatusColor('EXPIRED')).toBe('var(--tone-danger-fg)');
  });
});
