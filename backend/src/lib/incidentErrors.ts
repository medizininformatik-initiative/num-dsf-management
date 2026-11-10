/**
 * incidentErrors.ts – HTTP status of the incident register's business errors,
 * shared by the user and the admin incident routes. Unknown errors are
 * rethrown to the global error handler.
 * Dependencies: express (types)
 */
import type { Response } from 'express';

const STATUS: Record<string, number> = {
  INCIDENT_NOT_FOUND: 404,
  ORGANIZATION_NOT_FOUND: 404,
  FORBIDDEN: 403,
  ALREADY_ACKNOWLEDGED: 409,
  INVALID_STATUS: 409,
  NO_ORGANIZATION: 409,
  ALREADY_SUSPENDED: 409,
  NOT_SUSPENDED: 409,
  STILL_SUSPENDED: 409,
};

/** Answer a known incident error; returns false for anything else. */
export function sendIncidentError(res: Response, err: unknown): boolean {
  const code = err instanceof Error ? err.message : '';
  const status = STATUS[code];
  if (!status) return false;
  res.status(status).json({ error: { code, message: code } });
  return true;
}
