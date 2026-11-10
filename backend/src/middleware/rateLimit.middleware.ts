/**
 * rateLimit.middleware.ts – Rate limiting configuration
 * Dependencies: express-rate-limit, rate-limit-redis, ioredis
 *
 * Auth routes: 5 req / 15 min per IP
 * API routes: 100 req / 1 min per user (RATE_LIMIT_API_MAX)
 *
 * Sizing: one canvas page load makes about 12 API requests (me, instances,
 * instance, organization, contacts, endpoints, certificates, memberships,
 * approval status + history, expiring certs) and an instance switch about 9;
 * polling is at most 2-3 requests/min and only while the tab is visible. Normal
 * use stays far below 100/min, so the default is kept. nginx's per-IP limit is
 * only a coarse safety net above this per-user control.
 */
import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redis } from '../services/redis.service';
import { verifyAccessToken } from '../services/auth.service';
import { auditedLimitHandler } from './rateLimitAudit';
import { extractClientCert } from '../lib/clientCert';

function createRedisStore(prefix: string) {
  return new RedisStore({
    prefix: `ratelimit:${prefix}:`,
    sendCommand: (...args: string[]) => (redis as any).call(...args),
  } as any);
}

export const otpRateLimit = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_OTP_WINDOW_MS || '900000'),
  max: parseInt(process.env.RATE_LIMIT_OTP_MAX || '5'),
  store: createRedisStore('otp'),
  handler: auditedLimitHandler('otp'),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait 15 minutes.' },
  },
});

// /auth/client-cert-login: the SPA calls it on every reload and new tab in cert
// mode, so it must not share the tight per-IP OTP bucket (everyone behind one
// NAT would lock each other out). Keyed by the presented certificate's SHA-512
// fingerprint (the proxy-verified one), falling back to the IP, and generous.
export const certLoginRateLimit = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_CERT_LOGIN_WINDOW_MS || '900000'),
  max: parseInt(process.env.RATE_LIMIT_CERT_LOGIN_MAX || '120'),
  store: createRedisStore('cert-login'),
  handler: auditedLimitHandler('cert-login'),
  keyGenerator: (req) => {
    const fp = extractClientCert(req)?.fingerprint;
    return fp ? `cert:${fp}` : req.ip || 'unknown';
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: { code: 'RATE_LIMITED', message: 'Too many login attempts. Please wait a moment.' },
  },
});

// Failed certificate logins per source IP. The per-certificate bucket above
// cannot stop one source presenting many different certificates (each is a
// new bucket); this one counts only failures (status >= 400), so working
// clients behind one NAT are never throttled by it.
export const certLoginFailureIpRateLimit = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_CERT_LOGIN_FAIL_WINDOW_MS || '900000'),
  max: parseInt(process.env.RATE_LIMIT_CERT_LOGIN_FAIL_MAX || '30'),
  store: createRedisStore('cert-login-fail'),
  handler: auditedLimitHandler('cert-login-fail'),
  keyGenerator: (req) => req.ip || 'unknown',
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: { code: 'RATE_LIMITED', message: 'Too many failed login attempts. Please wait.' },
  },
});

// Session-maintenance limiter for /auth/refresh — a generous, SEPARATE bucket.
// Refresh is routine (access tokens expire every ~15 min, multiplied by open
// tabs), not a credential attempt, so it must not share the tight 5/15min OTP
// bucket — otherwise a logged-in user 429s themselves mid-session.
export const refreshRateLimit = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_REFRESH_WINDOW_MS || '900000'),
  max: parseInt(process.env.RATE_LIMIT_REFRESH_MAX || '60'),
  store: createRedisStore('refresh'),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait a moment.' },
  },
});

// Step-up brute-force guard for the 6-digit TOTP on admin write routes. These
// run after requireAuth, so req.user is set and we key per admin. Sized for
// legitimate multi-action admin work (locking several users, reviewing a batch
// of promotions) while still bounding how many guesses a stolen access token
// can make against the rotating 6-digit code.
export const stepUpTotpRateLimit = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_STEPUP_WINDOW_MS || '900000'),
  max: parseInt(process.env.RATE_LIMIT_STEPUP_MAX || '20'),
  store: createRedisStore('stepup'),
  handler: auditedLimitHandler('stepup'),
  keyGenerator: (req) => `user:${(req as { user?: { id: string } }).user?.id || req.ip}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait.' } },
});

// Backup downloads stream a file holding the whole database (contact PII,
// encrypted TOTP secrets); cap them per admin on top of the step-up limiter.
export const backupDownloadRateLimit = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_BACKUP_DOWNLOAD_WINDOW_MS || '900000'),
  max: parseInt(process.env.RATE_LIMIT_BACKUP_DOWNLOAD_MAX || '10'),
  store: createRedisStore('backup-download'),
  keyGenerator: (req) => `user:${(req as { user?: { id: string } }).user?.id || req.ip}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many backup downloads. Please wait.' } },
});

// Bulk cert-onboarding import is a heavy, DB-writing admin action (up to
// 1000 rows per call); a modest per-admin cap bounds a runaway or scripted
// re-import without blocking a legitimate multi-file onboarding session.
export const onboardingImportRateLimit = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_ONBOARDING_WINDOW_MS || '900000'),
  max: parseInt(process.env.RATE_LIMIT_ONBOARDING_MAX || '10'),
  store: createRedisStore('onboarding-import'),
  keyGenerator: (req) => `user:${(req as { user?: { id: string } }).user?.id || req.ip}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many import attempts. Please wait.' } },
});

export const apiRateLimit = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_API_WINDOW_MS || '60000'),
  max: parseInt(process.env.RATE_LIMIT_API_MAX || '100'),
  store: createRedisStore('api'),
  // This limiter is mounted at the app level (on /api) BEFORE any router's
  // requireAuth runs, so req.user is not yet set. Decode the bearer token here
  // to key by user id; otherwise the documented "100/min per user" cap silently
  // degrades to per-IP, letting users behind one NAT throttle each other while
  // a single user rotating IPs gets unlimited throughput. Fall back to IP for
  // unauthenticated or invalid-token requests.
  keyGenerator: (req) => {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        return `user:${verifyAccessToken(authHeader.slice(7)).sub}`;
      } catch {
        /* invalid/expired token — fall through to IP keying */
      }
    }
    return req.ip || 'unknown';
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many requests.' } },
});
