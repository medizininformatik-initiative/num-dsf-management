/**
 * authMode.ts – Backend switch for the certificate-only deployment.
 *
 * AUTH_MODE=cert (set by docker-compose.cert-auth.yml) turns the backend into
 * a client-certificate-only service, independent of what the front proxy
 * does: the OTP/TOTP login routes answer 403, /auth/refresh needs the
 * certificate again, and every authenticated request must carry the client
 * certificate its session was minted for. Any other value keeps the default
 * OTP/TOTP behaviour. Read per call so tests can toggle it.
 */
export function isCertAuthMode(): boolean {
  return (process.env.AUTH_MODE ?? '').trim().toLowerCase() === 'cert';
}
