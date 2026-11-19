/**
 * loginLockout.ts — Whether the site would lose every certificate login: it has certificates,
 * none is marked for login and no login entry exists that does not come from an approval
 * (onboarding, admin, migrated). The same rule as the backend's CERT_NO_LOGIN finding. A
 * certificate without the flag (older data) counts as a login certificate; unknown login
 * entries (still loading) never warn. Pure.
 * Dependencies: api/loginCertificates.api (types)
 */
import type { LoginCertificate } from '../api/loginCertificates.api';

export function wouldLoseCertificateLogin(
  certs: ReadonlyArray<{ useForLogin?: boolean }>,
  loginEntries: ReadonlyArray<Pick<LoginCertificate, 'source'>> | undefined,
): boolean {
  if (!loginEntries || certs.length === 0) return false;
  if (certs.some((c) => c.useForLogin !== false)) return false;
  return !loginEntries.some((e) => e.source !== 'APPROVAL');
}
