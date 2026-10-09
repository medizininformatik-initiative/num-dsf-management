/**
 * isAdmin.ts – DB-backed admin role check with cryptographic signature
 * verification. Delegates to lib/adminGrants; ignores IMI_ADMIN_EMAILS at
 * runtime (used only for first-run bootstrap by admin-bootstrap.service).
 */
import { isVerifiedAdminEmail } from './adminGrants';

/**
 * Admin check for an authenticated request. An org-scoped session (organization
 * login certificate) is NEVER admin, even if its owner user holds an admin
 * grant: admin rights come only from admin certificate / OTP admin logins.
 */
export async function isAdminCaller(
  user: { email: string; scopeInstanceId?: string } | null | undefined,
): Promise<boolean> {
  if (!user || user.scopeInstanceId) return false;
  return isAdminEmail(user.email);
}

export async function isAdminEmail(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  return isVerifiedAdminEmail(email);
}
