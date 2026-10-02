/**
 * certStatus.test.ts — certificate validity classification at the 0/30/90-day
 * boundaries, with "now" pinned by fake timers.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { certValidity, CERT_CRITICAL_DAYS, CERT_WARNING_DAYS } from '../certStatus';

const NOW = new Date('2026-10-02T12:00:00Z');
const inDays = (n: number) => new Date(NOW.getTime() + n * 86400000).toISOString();

describe('certValidity', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('marks a past date as expired with negative days', () => {
    expect(certValidity(inDays(-12))).toEqual({ state: 'expired', days: -12 });
  });

  it('treats the remaining part of the last day as critical, not expired', () => {
    expect(certValidity(inDays(0.5)).state).toBe('critical');
  });

  it('switches from critical to warning to valid at the thresholds', () => {
    expect(certValidity(inDays(CERT_CRITICAL_DAYS - 1)).state).toBe('critical');
    expect(certValidity(inDays(CERT_CRITICAL_DAYS)).state).toBe('warning');
    expect(certValidity(inDays(CERT_WARNING_DAYS - 1)).state).toBe('warning');
    expect(certValidity(inDays(CERT_WARNING_DAYS)).state).toBe('valid');
  });

  it('treats an unparseable date as valid instead of propagating NaN', () => {
    expect(certValidity('not-a-date').state).toBe('valid');
  });
});
