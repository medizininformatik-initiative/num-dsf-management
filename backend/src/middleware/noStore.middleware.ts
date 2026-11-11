/**
 * noStore.middleware.ts – marks every response as uncacheable. API, auth and
 * FHIR answers are per-user or change at any time (incident banner, approval
 * state, allow list), so no browser or proxy may reuse them without asking
 * the backend. Headers are set before the route runs, so a route can still
 * override them (the backup and audit exports already send their own no-store).
 * Dependencies: express
 */
import type { NextFunction, Request, Response } from 'express';

export function noStore(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.vary('Authorization');
  res.vary('Cookie');
  next();
}
