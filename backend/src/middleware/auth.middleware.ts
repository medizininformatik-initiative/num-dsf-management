/**
 * auth.middleware.ts – JWT verification, request identity injection
 * req.user.authMethod carries the token's amr claim ('otp' | 'cert', default
 * 'otp') so downstream guards (stepUp.middleware) know whether a sensitive
 * write can be re-verified with a TOTP code or must re-present a client cert.
 * Dependencies: auth.service (verifyAccessToken)
 */
import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../services/auth.service';
import { redis } from '../services/redis.service';

// Extend req.user types
declare global {
  namespace Express {
    interface Request {
      user?: { id: string; email: string; authMethod: 'otp' | 'cert' };
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing token' } });
    return;
  }

  try {
    const token = authHeader.slice(7);
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, email: payload.email, authMethod: payload.amr ?? 'otp' };
    // Update activity timestamp for idle timeout (fire-and-forget, non-blocking)
    const idleTimeout = parseInt(process.env.IDLE_TIMEOUT_MS || '1800000', 10);
    redis
      .setex(`activity:${payload.sub}`, Math.ceil(idleTimeout / 1000), Date.now().toString())
      .catch(() => {});
    next();
  } catch {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } });
  }
}
