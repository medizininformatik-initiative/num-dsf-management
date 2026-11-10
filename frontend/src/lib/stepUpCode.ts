/**
 * stepUpCode.ts – the second factor of a step-up: a 6-digit authenticator code
 * or a TAN (one of the 8-character single-use backup codes, hex digits).
 * Dependencies: none.
 */

/** True for a complete 6-digit code or a complete 8-character TAN. */
export function isStepUpCodeComplete(code: string): boolean {
  return /^\d{6}$/.test(code) || /^[0-9A-Fa-f]{8}$/.test(code);
}

/** What a user may type as a TAN: hex characters only (dashes and spaces from a paste dropped), upper case, at most 8. */
export function sanitizeTan(input: string): string {
  return input
    .replace(/[^0-9a-fA-F]/g, '')
    .toUpperCase()
    .slice(0, 8);
}
