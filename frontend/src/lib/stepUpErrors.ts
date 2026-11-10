/**
 * stepUpErrors.ts – the backend error codes of a failed step-up (see
 * stepUp.middleware): wrong or missing TOTP code, TOTP not set up, failed
 * certificate re-verification. They are not session expiry, and each maps to
 * one translated message for the step-up dialog.
 * Dependencies: i18n keys.
 */
import type { TranslationKey } from '../i18n/en';

const STEP_UP_ERROR_KEY: Record<string, TranslationKey> = {
  TOTP_INVALID: 'totpInvalidCode',
  TOTP_REQUIRED: 'totpDigitsRequired',
  TOTP_NOT_CONFIGURED: 'totpNotConfigured',
  CERT_STEP_UP_FAILED: 'certStepUpFailedToast',
};

export function isStepUpErrorCode(code: string | undefined): boolean {
  return !!code && code in STEP_UP_ERROR_KEY;
}

export function stepUpErrorKey(code: string): TranslationKey | undefined {
  return STEP_UP_ERROR_KEY[code];
}
