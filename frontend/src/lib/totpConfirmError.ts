/**
 * totpConfirmError.ts – classifies a failed POST /me/totp/confirm by its backend
 * error code (wrong code, code already used, setup expired, rate limited,
 * anything else) so the enrolment can say what actually went wrong.
 * Dependencies: lib/getErrorMessage.
 */
import { getErrorCode } from './getErrorMessage';

export type ConfirmErrorKind = 'invalid' | 'used' | 'expired' | 'rate' | 'other';

export function statusOf(err: unknown): string | undefined {
  const status = (err as { response?: { status?: number } })?.response?.status;
  return status ? `HTTP ${status}` : undefined;
}

/** Maps a failed POST /me/totp/confirm to the reason shown to the user. */
export function confirmErrorKind(err: unknown): ConfirmErrorKind {
  if ((err as { response?: { status?: number } })?.response?.status === 429) return 'rate';
  switch (getErrorCode(err)) {
    case 'TOTP_INVALID':
      return 'invalid';
    case 'TOTP_CODE_USED':
      return 'used';
    case 'TOTP_ENROLMENT_EXPIRED':
      return 'expired';
    case 'RATE_LIMITED':
      return 'rate';
    default:
      return 'other';
  }
}
