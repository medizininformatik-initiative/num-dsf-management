/**
 * auth.middleware.ts – JWT verification, request identity injection
 * req.user.authMethod carries the token's amr claim ('otp' | 'cert', default
 * 'otp') so downstream guards (stepUp.middleware) know whether a sensitive
 * write can be re-verified with a TOTP code or must re-present a client cert.
 *
 * With AUTH_MODE=cert (certificate-only deployment) the bearer token alone is
 * never enough, see certSessionValid below.
 * An org-scoped session (token claims kind:'org' + inst, issued for an
 * organization login certificate) carries req.user.scopeInstanceId: it may
 * only use that one instance and is never admin (lib/isAdmin.isAdminCaller).
 * Such a token is refused once an incident ended that scope
 * (scope-revocation.service).
 * Dependencies: auth.service (verifyAccessToken, findCertBinding), lib/authMode,
 * lib/clientCert, db/connection, scope-revocation.service
 */
import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, findCertBinding } from '../services/auth.service';
import { redis } from '../services/redis.service';
import { isScopeRevoked } from '../services/scope-revocation.service';
import { isCertAuthMode } from '../lib/authMode';
import { extractClientCert } from '../lib/clientCert';
import { db } from '../db/connection';
import { isTotpEnrolmentRequired } from '../lib/totpEnrolment';

// Extend req.user types
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        authMethod: 'otp' | 'cert';
        /** Set for an org-scoped session: the only instance it may access. */
        scopeInstanceId?: string;
      };
    }
  }
}

/**
 * Certificate-only deployment: the session must be a cert session (amr), the
 * request must carry the client certificate the proxy verified, that
 * certificate must still resolve to the token's user AND scope (a revoked or
 * removed login certificate ends the session on the very next request; an
 * org-scoped token needs an organization certificate of the same instance, an
 * unscoped token an admin certificate) and the account must not be locked or
 * de-whitelisted.
 */
async function certSessionValid(
  req: Request,
  sub: string,
  email: string,
  amr: string,
  scopeInstanceId: string | undefined,
): Promise<boolean> {
  if (amr !== 'cert') return false;
  const fingerprint = extractClientCert(req)?.fingerprint;
  if (!fingerprint) return false;
  const binding = await findCertBinding(fingerprint);
  if (!binding || binding.userId !== sub) return false;
  if (scopeInstanceId) {
    if (binding.kind !== 'org' || binding.instanceId !== scopeInstanceId) return false;
  } else if (binding.kind !== 'admin') {
    return false;
  }
  const wl = await db('email_whitelist').where({ email: email.toLowerCase().trim() }).first();
  return !!wl && !wl.locked_at;
}

/**
 * Express 4 does not catch a rejected promise from async middleware; any error
 * goes to next(err) so the global error handler answers.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await authenticate(req, res, next, false);
  } catch (err) {
    next(err);
  }
}

/**
 * Like requireAuth, but also lets an admin certificate session through that has
 * not enrolled TOTP yet. Only for /auth/me and the TOTP enrolment endpoints.
 */
export async function requireAuthAllowEnrolment(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await authenticate(req, res, next, true);
  } catch (err) {
    next(err);
  }
}

async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction,
  allowUnenrolled: boolean,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing token' } });
    return;
  }

  let payload: ReturnType<typeof verifyAccessToken>;
  try {
    payload = verifyAccessToken(authHeader.slice(7));
  } catch {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } });
    return;
  }

  // kind:'org' without an instance is malformed; never fall back to unscoped.
  if (payload.kind === 'org' && !payload.inst) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } });
    return;
  }
  const scopeInstanceId = payload.kind === 'org' ? payload.inst : undefined;
  // An incident ended this organization scope: tokens issued before are void.
  if (scopeInstanceId) {
    let revoked = true;
    try {
      revoked = await isScopeRevoked(scopeInstanceId, payload.iat);
    } catch {
      // Fail closed: without Redis the revocation cannot be checked.
    }
    if (revoked) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Session ended' } });
      return;
    }
  }

  if (isCertAuthMode()) {
    let ok = false;
    try {
      ok = await certSessionValid(
        req,
        payload.sub,
        payload.email,
        payload.amr ?? 'otp',
        scopeInstanceId,
      );
    } catch {
      ok = false;
    }
    if (!ok) {
      res.status(401).json({
        error: {
          code: 'CERT_REQUIRED',
          message: 'A valid registered client certificate is required.',
        },
      });
      return;
    }
  }

  req.user = {
    id: payload.sub,
    email: payload.email,
    authMethod: payload.amr ?? 'otp',
    ...(scopeInstanceId ? { scopeInstanceId } : {}),
  };
  // An admin who signed in with a certificate must enrol TOTP first; until
  // then the session reaches only the enrolment endpoints.
  if (!allowUnenrolled && (await isTotpEnrolmentRequired(req.user))) {
    res.status(403).json({
      error: {
        code: 'TOTP_ENROLMENT_REQUIRED',
        message: 'Set up TOTP before using this session.',
      },
    });
    return;
  }
  // Update activity timestamp for idle timeout (fire-and-forget, non-blocking)
  const idleTimeout = parseInt(process.env.IDLE_TIMEOUT_MS || '1800000', 10);
  redis
    .setex(`activity:${payload.sub}`, Math.ceil(idleTimeout / 1000), Date.now().toString())
    .catch(() => {});
  next();
}
