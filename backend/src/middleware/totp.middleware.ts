/**
 * totp.middleware.ts – requireFreshTotp step-up guard.
 *
 * Thin re-export of stepUp.middleware's requireStepUp, kept under its
 * original name so the existing routers (admin-users, admin-promotions,
 * admin-ca-blacklist) need no changes. requireStepUp covers everything this
 * used to (a fresh 6-digit TOTP code for an OTP-authenticated session) plus
 * a re-presented client certificate for a cert-authenticated session, which
 * cannot produce a TOTP code — see stepUp.middleware.ts for the full
 * contract.
 *
 * Use AFTER requireAuth (relies on req.user) and behind the step-up rate
 * limiter so a stolen access token cannot grind the 6-digit code space.
 *
 * Dependencies: stepUp.middleware
 */
export { requireStepUp as requireFreshTotp } from './stepUp.middleware';
