/**
 * incident-nis2.service.ts – NIS2 reporting aids of an incident beyond the
 * plain "reported to BSI" tick: the date the BSI asked for an interim report
 * and the structured report fields per stage. Same rule as the ticks: admins,
 * the reporter and users of the affected site may do it. Every change is a
 * hash-chained UPDATED event and an audit entry; the events carry the stage
 * and field names, never the field texts.
 * Dependencies: incidents.service
 */
import { db } from '../db/connection';
import { fieldHash } from '../lib/incidentHashChain';
import { NIS2_COLUMNS, type Nis2Stage } from '../lib/nis2Deadlines';
import { FIELD_STAGE, parseNis2Data, stageFields, stageHashValue } from '../lib/nis2Entries';
import { NIS2_DATA_KEY, type Nis2Data } from '../schemas/nis2Report.schema';
import { appendEvent } from './incident-events.service';
import {
  assertNis2Editable,
  auditIncident,
  canAcknowledge,
  changeWithEvent,
  requireVisible,
  toApi,
  loadIncidentRow,
  type ApiIncident,
  type IncidentCaller,
  type IncidentRow,
} from './incidents.service';

const HASH_FIELD = {
  EARLY_WARNING: 'nis2EarlyWarning',
  NOTIFICATION: 'nis2Notification',
  FINAL_REPORT: 'nis2FinalReport',
} as const;

/**
 * Save report fields of a stage (a draft: any subset; an empty text clears a
 * field). The progress report shares the final report's fields. A stage that
 * was ticked as reported is a record and stays as it was.
 * @throws FORBIDDEN / INVALID_STATUS (false alarm) / ALREADY_ACKNOWLEDGED / NIS2_STAGE_WITHOUT_FIELDS
 */
export async function updateNis2Fields(
  id: string,
  stage: Nis2Stage,
  input: Record<string, string>,
  caller: IncidentCaller,
): Promise<ApiIncident> {
  const fieldStage = FIELD_STAGE[stage];
  if (!fieldStage) throw new Error('NIS2_STAGE_WITHOUT_FIELDS');
  const row = await requireVisible(id, caller);
  if (!canAcknowledge(row, caller)) throw new Error('FORBIDDEN');
  const reportedCol = NIS2_COLUMNS[fieldStage].at;
  const check = (locked: IncidentRow) => {
    assertNis2Editable(locked);
    if ((locked as unknown as Record<string, unknown>)[reportedCol]) {
      throw new Error('ALREADY_ACKNOWLEDGED');
    }
  };
  check(row);
  const changed = await db.transaction(async (trx) => {
    const locked = (await trx('incidents').where({ id }).forUpdate().first()) as IncidentRow;
    check(locked);
    const current = stageFields(locked.nis2_data, fieldStage);
    const next: Record<string, string> = { ...current };
    for (const [key, value] of Object.entries(input)) {
      if (value === '') delete next[key];
      else next[key] = value;
    }
    const keys = Object.keys({ ...current, ...next }).filter((k) => current[k] !== next[k]);
    if (keys.length === 0) return [];
    const data: Nis2Data = parseNis2Data(locked.nis2_data);
    const dataKey = NIS2_DATA_KEY[fieldStage];
    if (Object.keys(next).length > 0) data[dataKey] = next;
    else delete data[dataKey];
    await trx('incidents')
      .where({ id })
      .update({ nis2_data: JSON.stringify(data) });
    await appendEvent(trx, id, caller.email, 'UPDATED', {
      field: 'nis2Fields',
      stage,
      changed: keys.sort(),
      fieldSha256: {
        [HASH_FIELD[fieldStage]]: fieldHash(stageHashValue(data, fieldStage)),
      },
    });
    return keys;
  });
  if (changed.length > 0) {
    await auditIncident(row, caller, 'UPDATE', {
      action: 'incident_nis2_fields',
      stage,
      changed,
    });
  }
  return toApi((await loadIncidentRow(id))!, caller);
}

/**
 * The BSI asked for an interim report on `requestedAt`; it can then be ticked
 * as reported. A new request before the tick replaces the date.
 * @throws FORBIDDEN / INVALID_STATUS (false alarm) / ALREADY_ACKNOWLEDGED (interim report already ticked)
 */
export async function requestInterimReport(
  id: string,
  requestedAt: string,
  caller: IncidentCaller,
): Promise<ApiIncident> {
  const row = await requireVisible(id, caller);
  if (!canAcknowledge(row, caller)) throw new Error('FORBIDDEN');
  const to = new Date(requestedAt);
  const check = (locked: typeof row) => {
    assertNis2Editable(locked);
    if (locked.bsi_interim_at) throw new Error('ALREADY_ACKNOWLEDGED');
  };
  check(row);
  await changeWithEvent(
    id,
    { bsi_interim_requested_at: to, bsi_interim_requested_by: caller.email },
    caller.email,
    'UPDATED',
    {
      field: 'nis2InterimRequest',
      from: row.bsi_interim_requested_at
        ? new Date(row.bsi_interim_requested_at).toISOString()
        : null,
      to: to.toISOString(),
    },
    check,
  );
  await auditIncident(row, caller, 'UPDATE', { action: 'incident_nis2_interim_request' });
  return toApi((await loadIncidentRow(id))!, caller);
}
