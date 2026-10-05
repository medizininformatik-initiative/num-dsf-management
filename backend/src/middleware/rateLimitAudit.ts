/**
 * rateLimitAudit.ts – express-rate-limit handler that leaves an audit trail.
 * Dependencies: express-rate-limit (types), audit.service
 *
 * Records RATE_LIMITED (bucket + path, never request bodies) before answering
 * with the limiter's configured 429 body. The audit write never blocks the response.
 */
import type { Options } from 'express-rate-limit';
import { writeAuditLog } from '../services/audit.service';

export function auditedLimitHandler(bucket: string): Options['handler'] {
  return (req, res, _next, options) => {
    const email =
      (req as { user?: { email?: string } }).user?.email ||
      (typeof req.body?.email === 'string' ? req.body.email : undefined);
    writeAuditLog({
      userEmail: email,
      resourceType: 'AUTH',
      operation: 'RATE_LIMITED',
      diffJson: { bucket, path: (req.originalUrl ?? req.url ?? '').split('?')[0] },
      ipAddress: req.ip || 'unknown',
    }).catch(() => {});
    res.status(options.statusCode).send(options.message);
  };
}
