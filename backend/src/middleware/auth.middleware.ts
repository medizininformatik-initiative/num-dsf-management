/**
 * auth.middleware.ts – JWT verification, request identity injection
 * req.user.authMethod carries the token's amr claim ('otp' | 'cert', default
 * 'otp') so downstream guards (stepUp.middleware) know whether a sensitive
 * write can be re-verified with a TOTP code or must re-present a client cert.
 *
 * With AUTH_MODE=cert (certificate-only deployment) the bearer token alone is
 * never enough, see certSessionValid below.
 * Dependencies: auth.service (verifyAccessToken, findCertUserId), lib/authMode,
 * lib/clientCert, db/connection
 */
import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, findCertUserId } from '../services/auth.service';
import { redis } from '../services/redis.service';
import { isCertAuthMode } from '../lib/authMode';
import { extractClientCert } from '../lib/clientCert';
import { db } from '../db/connection';

// Extend req.user types
declare global {
  namespace Express {
    interface Request {
      user?: { id: string; email: string; authMethod: 'otp' | 'cert' };
    }
  }
}

/**
 * Certificate-only deployment: the session must be a cert session (amr), the
 * request must carry the client certificate the proxy verified, that
 * certificate must still resolve to the token's user (a revoked or removed
 * certificate ends the session on the very next request) and the account must
 * not be locked or de-whitelisted.
 */
async function certSessionValid(
  req: Request,
  sub: string,
  email: string,
  amr: string,
): Promise<boolean> {
  if (amr !== 'cert') return false;
  const fingerprint = extractClientCert(req)?.fingerprint;
  if (!fingerprint) return false;
  if ((await findCertUserId(fingerprint)) !== sub) return false;
  const wl = await db('email_whitelist').where({ email: email.toLowerCase().trim() }).first();
  return !!wl && !wl.locked_at;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
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

  if (isCertAuthMode()) {
    let ok = false;
    try {
      ok = await certSessionValid(req, payload.sub, payload.email, payload.amr ?? 'otp');
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

  req.user = { id: payload.sub, email: payload.email, authMethod: payload.amr ?? 'otp' };
  // Update activity timestamp for idle timeout (fire-and-forget, non-blocking)
  const idleTimeout = parseInt(process.env.IDLE_TIMEOUT_MS || '1800000', 10);
  redis
    .setex(`activity:${payload.sub}`, Math.ceil(idleTimeout / 1000), Date.now().toString())
    .catch(() => {});
  next();
}
