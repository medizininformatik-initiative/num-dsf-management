/**
 * stepUp.middleware.ts – Unified step-up re-verification for sensitive admin
 * writes.
 *
 * An OTP-authenticated session (req.user.authMethod === 'otp', the default)
 * proves it is still the account holder with a fresh 6-digit TOTP code, same
 * as before. A cert-authenticated session (POST /auth/client-cert-login)
 * cannot produce one, so it instead re-presents the same client certificate
 * it logged in with; the guard re-verifies it via lib/clientCert +
 * auth.service.resolveCertLogin and requires it to resolve to the SAME user.
 *
 * checkStepUp is the pure check (returns a result instead of writing a
 * response) so callers that only need step-up inside a conditional
 * (organization.routes) can inspect the result themselves. requireStepUp
 * wraps it as an Express middleware for routers that always require it.
 *
 * Use AFTER requireAuth (relies on req.user) and behind the step-up rate
 * limiter so a stolen access token cannot grind the 6-digit code space.
 *
 * Residual risk (accepted): the cert branch is non-interactive. The browser
 * attaches the client certificate to every request on its own, so unlike a
 * typed TOTP code it does not prove the user intended this particular write.
 * Script running inside the page, for example from an XSS bug or a
 * malicious browser extension, can trigger an admin write under this guard
 * the same way a genuine click would. The Content-Security-Policy and the
 * same-origin session cookie are the controls for this path; see
 * docs/DEPLOYMENT.md's cert-auth section for the operator-facing note.
 *
 * Dependencies: express, totp.service, lib/clientCert, auth.service,
 * db/connection
 */
import { Request, Response, NextFunction } from 'express';
import { verifyTotpCode, isDevTotpBypassActive } from '../services/totp.service';
import { extractClientCert } from '../lib/clientCert';
import { resolveCertLogin } from '../services/auth.service';
import { db } from '../db/connection';
import { writeAuditLog } from '../services/audit.service';

export type StepUpResult =
  | { ok: true }
  | { ok: false; status: 400 | 401 | 403; code: string; message: string };

/**
 * @param totpCode the code to verify for an OTP session; defaults to
 *   req.body.totpCode (JSON routes). Raw-body routes pass the X-Totp-Code header.
 */
export async function checkStepUp(
  req: Request,
  totpCode: unknown = req.body?.totpCode,
): Promise<StepUpResult> {
  if (req.user?.authMethod === 'cert') {
    const cert = extractClientCert(req);
    if (!cert?.fingerprint) {
      return {
        ok: false,
        status: 401,
        code: 'CERT_STEP_UP_FAILED',
        message: 'Client certificate re-verification failed.',
      };
    }
    const resolved = await resolveCertLogin(cert.fingerprint);
    if (!resolved || resolved.user.id !== req.user.id) {
      return {
        ok: false,
        status: 401,
        code: 'CERT_STEP_UP_FAILED',
        message: 'Client certificate re-verification failed.',
      };
    }
    return { ok: true };
  }

  const code = totpCode;
  if (!code || typeof code !== 'string' || code.length !== 6) {
    return {
      ok: false,
      status: 400,
      code: 'TOTP_REQUIRED',
      message: '6-digit TOTP code required',
    };
  }

  // The dev TOTP bypass (totp.service.verifyTotpCode) short-circuits to valid
  // for any 6-digit code, so the config pre-check below would reject it before
  // that ever runs: CI seeds users with totp_enabled: true and no persisted
  // secret and sends a fixed dev code, relying on the bypass alone. Skip the
  // pre-check in that case only — the bypass predicate already re-derives the
  // same NODE_ENV/DEV_AUTO_LOGIN/DEV_TOTP_BYPASS allowlist, so this never
  // widens what is accepted when the bypass is inactive.
  if (!isDevTotpBypassActive()) {
    const user = (await db('users')
      .where({ id: req.user!.id })
      .select('totp_enabled', 'totp_secret')
      .first()) as { totp_enabled: boolean | number; totp_secret: string | null } | undefined;
    // Covers both: TOTP never enabled, and enabled but the secret was never
    // persisted (e.g. setup started but not completed). Either way there is
    // no secret to verify against, so this is a config problem, not a wrong code.
    if (!user?.totp_enabled || !user?.totp_secret) {
      return {
        ok: false,
        status: 403,
        code: 'TOTP_NOT_CONFIGURED',
        message: 'TOTP is not configured.',
      };
    }
  }

  const valid = await verifyTotpCode(req.user!.id, code);
  if (!valid) {
    return { ok: false, status: 401, code: 'TOTP_INVALID', message: 'Invalid TOTP code' };
  }
  return { ok: true };
}

/**
 * Step-up for routes whose body is not JSON (the raw-body onboarding upload).
 * A cert session re-presents its client certificate as before; an OTP session
 * sends its TOTP code in the X-Totp-Code header, since the body cannot carry it.
 */
export async function requireUploadStepUp(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  await enforceStepUp(req, res, next, req.get('x-totp-code'));
}

export async function requireStepUp(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  await enforceStepUp(req, res, next, req.body?.totpCode);
}

async function enforceStepUp(
  req: Request,
  res: Response,
  next: NextFunction,
  totpCode: unknown,
): Promise<void> {
  const result = await checkStepUp(req, totpCode);
  if (!result.ok) {
    // A missing code is a client mistake, not a verification attempt.
    if (result.code !== 'TOTP_REQUIRED') {
      writeAuditLog({
        userEmail: req.user?.email,
        resourceType: 'AUTH',
        operation: 'STEP_UP_FAILED',
        diffJson: { reason: result.code, path: (req.originalUrl ?? req.url ?? '').split('?')[0] },
        ipAddress: req.ip || 'unknown',
      }).catch(() => {});
    }
    res.status(result.status).json({ error: { code: result.code, message: result.message } });
    return;
  }
  next();
}
