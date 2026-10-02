/**
 * certStatus.ts – One classification of certificate validity for every view
 * (certificate card, expiry banner and timeline, readiness, upload preview),
 * so thresholds and wording cannot drift apart.
 * Dependencies: lib/dateUtils (daysUntil)
 */
import { daysUntil } from './dateUtils';

/** Fewer days than this left: renew now (danger). */
export const CERT_CRITICAL_DAYS = 30;
/** Fewer days than this left: plan the renewal (warning). */
export const CERT_WARNING_DAYS = 90;

export type CertState = 'expired' | 'critical' | 'warning' | 'valid';

export interface CertValidity {
  state: CertState;
  /** Whole days until expiry; negative once expired. */
  days: number;
}

/** Classify a certificate by its `valid_until` date. */
export function certValidity(validUntil: string): CertValidity {
  const days = daysUntil(validUntil);
  const state: CertState =
    days < 0
      ? 'expired'
      : days < CERT_CRITICAL_DAYS
        ? 'critical'
        : days < CERT_WARNING_DAYS
          ? 'warning'
          : 'valid';
  return { state, days };
}

/** Status tone per state, for pills, bars and icons. */
export const CERT_STATE_TONE: Record<CertState, 'danger' | 'warning' | 'success'> = {
  expired: 'danger',
  critical: 'danger',
  warning: 'warning',
  valid: 'success',
};
