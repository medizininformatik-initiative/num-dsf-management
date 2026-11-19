/**
 * totpEnrolment.ts – decides whether a session must enrol TOTP before it may
 * be used. Only an ADMIN signed in with a client certificate (an unscoped
 * cert session) needs TOTP, and until it has enrolled the session may only
 * reach the enrolment endpoints. Org-scoped site sessions and OTP sessions
 * are never affected (the OTP flow enrols TOTP at sign-in).
 * Dependencies: db/connection, lib/isAdmin, totp.service (dev bypass).
 */
import { db } from '../db/connection';
import { isAdminCaller } from './isAdmin';
import { isDevTotpBypassActive } from '../services/totp.service';

export interface SessionUser {
  id: string;
  email: string;
  authMethod: 'otp' | 'cert';
  scopeInstanceId?: string;
}

export async function isTotpEnrolmentRequired(user: SessionUser): Promise<boolean> {
  if (user.authMethod !== 'cert' || user.scopeInstanceId) return false;
  if (isDevTotpBypassActive()) return false;
  const row = (await db('users')
    .where({ id: user.id })
    .select('totp_enabled', 'totp_secret')
    .first()) as { totp_enabled: boolean | number; totp_secret: string | null } | undefined;
  // Enabled without a persisted secret (an older broken row) is not enrolled.
  if (row?.totp_enabled && row.totp_secret) return false;
  return isAdminCaller(user);
}
