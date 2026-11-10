/**
 * stepUpCode.ts – the optional `totpCode` body field of step-up routes: a
 * 6-digit authenticator code or a TAN (8 hex characters, optionally written
 * with spaces or a dash, so up to 10 characters). The exact format is checked
 * by middleware/stepUp.middleware, which answers 400 TOTP_REQUIRED otherwise.
 * Dependencies: zod.
 */
import { z } from 'zod';

export const stepUpCode = z.string().min(6).max(10).optional();
