/**
 * incident-nis2.service.ts – NIS2 reporting aids of an incident beyond the
 * plain "reported to BSI" tick: the date the BSI asked for an interim report
 * and the structured report fields per stage. Same rule as the ticks: admins,
 * the reporter and users of the affected site may do it. Every change is a
 * hash-chained UPDATED event and an audit entry; the events carry the stage
 * and field names, never the field texts.
 * Dependencies: incidents.service
 */
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
} from './incidents.service';

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
