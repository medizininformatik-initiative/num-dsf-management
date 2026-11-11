/**
 * incident-export.service.ts – One incident as a file for authority requests:
 * JSON (incident with description, full timeline, hash-chain values and the
 * chain verification) or CSV (the incident fields as key/value lines, then one
 * line per event with prev_hash and hash). Both carry the NIS2 stages in the
 * order of BSIG 32 with their report fields as a BSI form filling aid. Admin
 * only (see the route).
 * Dependencies: incidents.service, incident-events.service, auditExport.service (csvCell),
 *               lib/nis2Entries
 */
import {
  hashedFieldsOf,
  loadIncidentRow,
  toApi,
  type ApiIncident,
  type IncidentCaller,
} from './incidents.service';
import {
  listEvents,
  verifyEvents,
  type IncidentEvent,
  type IncidentVerification,
} from './incident-events.service';
import { csvCell } from './auditExport.service';
import type { Nis2Stage } from '../lib/nis2Deadlines';
import { FIELD_ORDER, FIELD_STAGE } from '../lib/nis2Entries';

/** One reporting stage as a block for filling in the BSI form (the portal does not report itself). */
export interface FormAidStage {
  stage: Nis2Stage;
  dueAt: Date | null;
  provisional: boolean;
  reportedAt: Date | null;
  reportedBy: string | null;
  /** Interim report only: when the BSI asked for it. */
  requestedAt: Date | null;
  /** The report fields in form order, empty when not filled yet; null for a stage without fields. */
  fields: Record<string, string> | null;
}

export interface IncidentExport {
  exportedAt: Date;
  exportedBy: string;
  incident: ApiIncident;
  /** The NIS2 stages in the order of BSIG § 32 as a form filling aid. */
  bsiFormAid: FormAidStage[];
  events: IncidentEvent[];
  chain: IncidentVerification;
}

export function nis2FormAid(incident: ApiIncident): FormAidStage[] {
  return incident.nis2.map((n) => {
    const fieldStage = FIELD_STAGE[n.stage];
    return {
      stage: n.stage,
      dueAt: n.dueAt,
      provisional: n.provisional,
      reportedAt: n.reportedAt,
      reportedBy: n.reportedBy,
      requestedAt: n.requestedAt ?? null,
      fields: fieldStage
        ? Object.fromEntries(FIELD_ORDER[fieldStage].map((k) => [k, n.fields?.[k] ?? '']))
        : null,
    };
  });
}

/** @throws INCIDENT_NOT_FOUND */
export async function buildIncidentExport(
  id: string,
  caller: IncidentCaller,
): Promise<IncidentExport> {
  const row = await loadIncidentRow(id);
  if (!row) throw new Error('INCIDENT_NOT_FOUND');
  const events = await listEvents(id);
  const incident = toApi(row, caller);
  return {
    exportedAt: new Date(),
    exportedBy: caller.email,
    incident,
    bsiFormAid: nis2FormAid(incident),
    events,
    chain: verifyEvents(id, events, hashedFieldsOf(row)),
  };
}

const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : '');

export function incidentExportCsv(doc: IncidentExport): string {
  const i = doc.incident;
  const fields: Array<[string, unknown]> = [
    ['id', i.id],
    ['title', i.title],
    ['description', i.description],
    ['status', i.status],
    ['escalation_level', i.escalationLevel],
    ['organization', i.organization?.identifier ?? ''],
    ['reported_by', i.reportedBy],
    ['reported_by_organization_certificate', i.reportedByOrganization],
    ['reported_at', iso(i.reportedAt)],
    ['became_aware_at', iso(i.detectedAt)],
    ['confirmed_by', i.confirmedBy],
    ['confirmed_at', iso(i.confirmedAt)],
    ['closed_by', i.closedBy],
    ['closed_at', iso(i.closedAt)],
    ['suspended', i.suspended],
    ['zulip_url', i.zulipUrl],
    // One section per stage in the order of BSIG 32, a filling aid for the BSI form.
    ...doc.bsiFormAid.flatMap((n): Array<[string, unknown]> => {
      const p = `nis2_${n.stage.toLowerCase()}`;
      return [
        [`${p}_due_at`, iso(n.dueAt)],
        ...(n.stage === 'FINAL_REPORT'
          ? [[`${p}_provisional`, n.provisional] as [string, unknown]]
          : []),
        ...(n.stage === 'INTERIM_REPORT'
          ? [[`${p}_requested_at`, iso(n.requestedAt)] as [string, unknown]]
          : []),
        [`${p}_reported_at`, iso(n.reportedAt)],
        [`${p}_reported_by`, n.reportedBy],
        ...Object.entries(n.fields ?? {}).map(([k, v]): [string, unknown] => [
          `${p}_${k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}`,
          v,
        ]),
      ];
    }),
    ['dpo_informed_at', iso(i.dpoInformed?.at ?? null)],
    ['dpo_informed_by', i.dpoInformed?.by ?? ''],
    ['chain_valid', doc.chain.valid],
    ['chain_broken_at', doc.chain.brokenAt ?? ''],
    ['chain_tampered_fields', doc.chain.tamperedFields.join(' ')],
    ['exported_at', iso(doc.exportedAt)],
    ['exported_by', doc.exportedBy],
  ];
  const lines = ['field,value', ...fields.map(([k, v]) => `${csvCell(k)},${csvCell(v)}`), ''];
  lines.push('seq,at,actor,type,details,prev_hash,hash');
  for (const e of doc.events) {
    lines.push(
      [
        e.seq,
        iso(e.at),
        e.actorEmail,
        e.type,
        e.details ? JSON.stringify(e.details) : '',
        e.prevHash,
        e.hash,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}

export function incidentExportFilename(id: string, format: 'json' | 'csv'): string {
  return `incident-${id}.${format}`;
}
