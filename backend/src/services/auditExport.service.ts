/**
 * auditExport.service.ts – CSV / JSON export of audit-log rows.
 *
 * CSV: UTF-8 BOM (Excel), CRLF lines, RFC-4180 quoting, and formula-injection
 * protection (cells starting with = + - @ TAB or CR get a leading apostrophe).
 * The body is written in chunks with backpressure, never as one string.
 *
 * Dependencies: express (types), auditQuery.service (row type)
 */
import type { Response } from 'express';
import type { CrossInstanceAuditRow } from './auditQuery.service';

/** Hard cap on exported rows. */
export const EXPORT_ROW_CAP = 50_000;
const CHUNK_ROWS = 500;

export const CSV_COLUMNS = [
  'timestamp',
  'site',
  'site_identifier',
  'instance_id',
  'user',
  'resource_type',
  'resource_id',
  'operation',
  'ip_address',
  'flags',
  'details',
] as const;

/** Neutralise spreadsheet formulas and quote when needed. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function isoOf(ts: unknown): string {
  const d = ts instanceof Date ? ts : new Date(String(ts));
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

function detailsOf(diff: unknown): string {
  if (diff === null || diff === undefined) return '';
  return typeof diff === 'string' ? diff : JSON.stringify(diff);
}

export function csvLine(row: CrossInstanceAuditRow): string {
  return (
    [
      isoOf(row.timestamp),
      row.organization_name ?? row.instance_label ?? '',
      row.organization_identifier ?? '',
      row.instance_id ?? '',
      row.user_email ?? '',
      row.resource_type ?? '',
      row.resource_id ?? '',
      row.operation ?? '',
      row.ip_address ?? '',
      (row.flags ?? []).map((f) => `${f.code}:${f.severity}`).join(' '),
      detailsOf(row.diff_json),
    ]
      .map(csvCell)
      .join(',') + '\r\n'
  );
}

function jsonRow(row: CrossInstanceAuditRow): Record<string, unknown> {
  return {
    timestamp: isoOf(row.timestamp),
    site: row.organization_name ?? row.instance_label ?? null,
    siteIdentifier: row.organization_identifier,
    instanceId: row.instance_id,
    user: row.user_email,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    operation: row.operation,
    ipAddress: row.ip_address,
    flags: row.flags ?? [],
    details: row.diff_json ?? null,
  };
}

async function write(res: Response, chunk: string): Promise<void> {
  if (!res.write(chunk)) {
    await new Promise<void>((resolve) => res.once('drain', resolve));
  }
}

export function exportFilename(scope: string, format: 'csv' | 'json', now = new Date()): string {
  return `audit-${scope}-${now.toISOString().slice(0, 10)}.${format}`;
}

/** Stream the rows as CSV or JSON to the response and end it. */
export async function streamAuditExport(
  res: Response,
  rows: CrossInstanceAuditRow[],
  format: 'csv' | 'json',
  filename: string,
  truncated: boolean,
): Promise<void> {
  res.setHeader(
    'Content-Type',
    format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
  );
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('X-Audit-Export-Rows', String(rows.length));
  res.setHeader('X-Audit-Export-Truncated', String(truncated));
  res.setHeader('Cache-Control', 'no-store');

  if (format === 'csv') {
    await write(res, '\uFEFF' + CSV_COLUMNS.join(',') + '\r\n');
    for (let i = 0; i < rows.length; i += CHUNK_ROWS) {
      await write(
        res,
        rows
          .slice(i, i + CHUNK_ROWS)
          .map(csvLine)
          .join(''),
      );
    }
  } else {
    await write(res, '[');
    for (let i = 0; i < rows.length; i += CHUNK_ROWS) {
      const part = rows
        .slice(i, i + CHUNK_ROWS)
        .map((r) => JSON.stringify(jsonRow(r)))
        .join(',');
      await write(res, (i > 0 ? ',' : '') + part);
    }
    await write(res, ']');
  }
  res.end();
}
