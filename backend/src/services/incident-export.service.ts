/**
 * incident-export.service.ts – One incident as a file for authority requests:
 * JSON (incident with description, full timeline, hash-chain values and the
 * chain verification) or CSV (the incident fields as key/value lines, then one
 * line per event with prev_hash and hash). Admin only (see the route).
 * Dependencies: incidents.service, incident-events.service, auditExport.service (csvCell)
 */
import { loadIncidentRow, toApi, type ApiIncident, type IncidentCaller } from './incidents.service';
import { listEvents, verifyEvents, type IncidentEvent } from './incident-events.service';
import type { ChainVerification } from '../lib/incidentHashChain';
import { csvCell } from './auditExport.service';

export interface IncidentExport {
  exportedAt: Date;
  exportedBy: string;
  incident: ApiIncident;
  events: IncidentEvent[];
  chain: ChainVerification;
}

/** @throws INCIDENT_NOT_FOUND */
export async function buildIncidentExport(
  id: string,
  caller: IncidentCaller,
): Promise<IncidentExport> {
  const row = await loadIncidentRow(id);
  if (!row) throw new Error('INCIDENT_NOT_FOUND');
  const events = await listEvents(id);
  return {
    exportedAt: new Date(),
    exportedBy: caller.email,
    incident: toApi(row, caller),
    events,
    chain: verifyEvents(id, events),
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
    ['reported_at', iso(i.reportedAt)],
    ['detected_at', iso(i.detectedAt)],
    ['confirmed_by', i.confirmedBy],
    ['confirmed_at', iso(i.confirmedAt)],
    ['closed_by', i.closedBy],
    ['closed_at', iso(i.closedAt)],
    ['suspended', i.suspended],
    ['zulip_url', i.zulipUrl],
    ...i.nis2.flatMap(
      (n): Array<[string, unknown]> => [
        [`nis2_${n.stage.toLowerCase()}_due_at`, iso(n.dueAt)],
        [`nis2_${n.stage.toLowerCase()}_reported_at`, iso(n.reportedAt)],
        [`nis2_${n.stage.toLowerCase()}_reported_by`, n.reportedBy],
      ],
    ),
    ['dpo_informed_at', iso(i.dpoInformed?.at ?? null)],
    ['dpo_informed_by', i.dpoInformed?.by ?? ''],
    ['chain_valid', doc.chain.valid],
    ['chain_broken_at', doc.chain.brokenAt ?? ''],
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
