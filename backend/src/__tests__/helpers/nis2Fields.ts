/**
 * nis2Fields.ts – Test helper: a complete, valid set of report fields per NIS2
 * stage, and a call that saves it, so a test can tick a stage as reported.
 * Dependencies: incident-nis2.service, incidents.service (types)
 */
import type { Nis2Stage } from '../../lib/nis2Deadlines';
import { updateNis2Fields } from '../../services/incident-nis2.service';
import type { IncidentCaller } from '../../services/incidents.service';

export const VALID_FIELDS: Partial<Record<Nis2Stage, Record<string, string>>> = {
  EARLY_WARNING: { suspectedMalicious: 'yes', crossBorder: 'no', affectedServices: 'BPE, FHIR' },
  NOTIFICATION: { severity: 'high', impact: 'BPE offline for two days' },
  FINAL_REPORT: {
    rootCause: 'Stolen credentials',
    mitigation: 'Keys rotated',
    crossBorderFinal: 'no',
  },
  PROGRESS_REPORT: {
    rootCause: 'Stolen credentials',
    mitigation: 'Keys rotated',
    crossBorderFinal: 'no',
  },
};

/** Save the complete field set of a stage (a no-op stage without fields is ignored). */
export async function fillStage(id: string, stage: Nis2Stage, caller: IncidentCaller) {
  const fields = VALID_FIELDS[stage];
  if (fields) await updateNis2Fields(id, stage, fields, caller);
}
