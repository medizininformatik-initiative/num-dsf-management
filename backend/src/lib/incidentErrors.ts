/**
 * incidentErrors.ts – HTTP status of the incident register's business errors,
 * shared by the user and the admin incident routes. Unknown errors are
 * rethrown to the global error handler. The NIS2 report errors carry a
 * German and English message (the code is the stable part for clients).
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
  NOT_ARCHIVABLE: 409,
  ALREADY_ARCHIVED: 409,
  INTERIM_NOT_REQUESTED: 409,
  STAGE_NOT_DUE: 409,
  NIS2_FIELDS_INCOMPLETE: 422,
  NIS2_STAGE_WITHOUT_FIELDS: 400,
};

const MESSAGES: Record<string, string> = {
  NOT_ARCHIVABLE:
    'Nur ein abgeschlossener Vorfall oder Fehlalarm ohne aktive Sperre kann archiviert werden. / Only a closed incident or false alarm without an active suspension can be archived.',
  ALREADY_ARCHIVED: 'Der Vorfall ist bereits archiviert. / The incident is already archived.',
  INTERIM_NOT_REQUESTED:
    'Das BSI hat keine Zwischenmeldung angefordert. / No interim report was requested by the BSI.',
  STAGE_NOT_DUE: 'Diese Meldestufe ist noch nicht fällig. / This reporting stage is not due yet.',
  NIS2_FIELDS_INCOMPLETE:
    'Die Pflichtangaben dieser Meldestufe sind nicht vollständig. / The required fields of this reporting stage are incomplete.',
  NIS2_STAGE_WITHOUT_FIELDS:
    'Diese Meldestufe hat keine Angaben. / This reporting stage has no fields.',
};

/** Ticking a stage as reported needs its report fields; `missing` names the empty ones. */
export class Nis2FieldsIncompleteError extends Error {
  constructor(readonly missing: string[]) {
    super('NIS2_FIELDS_INCOMPLETE');
  }
}

/** Answer a known incident error; returns false for anything else. */
export function sendIncidentError(res: Response, err: unknown): boolean {
  const code = err instanceof Error ? err.message : '';
  const status = STATUS[code];
  if (!status) return false;
  const details = err instanceof Nis2FieldsIncompleteError ? { missing: err.missing } : undefined;
  res.status(status).json({ error: { code, message: MESSAGES[code] ?? code, details } });
  return true;
}
