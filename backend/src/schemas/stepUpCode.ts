/**
 * stepUpCode.ts – the optional `totpCode` body field of step-up routes: a
 * 6-digit authenticator code or a TAN (8 hex characters, optionally written
 * with spaces or a dash, so up to 10 characters). The exact format is checked
 * by middleware/stepUp.middleware, which answers 400 TOTP_REQUIRED otherwise.
 * Dependencies: zod.
 */
import { z } from 'zod';

// An empty or whitespace-only value counts as absent: clients that always send
// the field (even when step-up is not needed) must not fail validation.
export const stepUpCode = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.string().min(6).max(10).optional(),
);
