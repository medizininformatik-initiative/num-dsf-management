/**
 * auditExport.service.test.ts – CSV escaping / formula-injection guard, JSON and
 * filename of the audit export. Dependencies: services/auditExport.service
 */
import { EventEmitter } from 'events';
import type { Response } from 'express';
import {
  CSV_COLUMNS,
  csvCell,
  csvLine,
  exportFilename,
  streamAuditExport,
} from '../services/auditExport.service';
import type { CrossInstanceAuditRow } from '../services/auditQuery.service';

function sampleRow(over: Partial<CrossInstanceAuditRow> = {}): CrossInstanceAuditRow {
  return {
    id: '1',
    timestamp: new Date('2026-03-10T10:00:00Z'),
    user_email: 'a@example.de',
    instance_id: 'i-1',
    resource_type: 'CONTACT',
    resource_id: 'c-1',
    operation: 'UPDATE',
    diff_json: { after: { name: 'Max, "M."' } },
    ip_address: '10.0.0.1',
    instance_label: 'label',
    organization_identifier: 'klinik.example.de',
    organization_name: 'Klinik Eins',
    flags: [{ code: 'RATE_LIMITED', severity: 'warning' }],
    ...over,
  };
}

function fakeRes() {
  const chunks: string[] = [];
  const headers: Record<string, string> = {};
  const res = Object.assign(new EventEmitter(), {
    setHeader: (k: string, v: string) => {
      headers[k] = v;
    },
    write: (c: string) => {
      chunks.push(c);
      return true;
    },
    end: () => {
      chunks.push('<END>');
    },
  });
  return { res: res as unknown as Response, chunks, headers };
}

describe('csvCell', () => {
  it.each(['=1+1', '+1', '-1', '@SUM(A1)', '\tx', '\rx'])('neutralises formula start %j', (v) => {
    const out = csvCell(v);
    expect(out.replace(/^"/, '').startsWith("'")).toBe(true);
  });

  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('l1\nl2')).toBe('"l1\nl2"');
  });

  it('renders null and undefined as empty and leaves plain text alone', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell('plain')).toBe('plain');
  });
});

describe('csvLine', () => {
  it('writes one column per header, ISO time and flags', () => {
    const line = csvLine(sampleRow());
    expect(line.endsWith('\r\n')).toBe(true);
    expect(line).toContain('2026-03-10T10:00:00.000Z');
    expect(line).toContain('Klinik Eins');
    expect(line).toContain('RATE_LIMITED:warning');
    // details JSON is quoted because it contains commas and quotes
    expect(line).toContain('"{""after"":{""name"":""Max, \\""M.\\""""}}"');
    expect(CSV_COLUMNS).toHaveLength(11);
  });

  it('guards a malicious actor value', () => {
    expect(csvLine(sampleRow({ user_email: '=HYPERLINK("http://x")' }))).toContain(
      `"'=HYPERLINK(""http://x"")"`,
    );
  });
});

describe('exportFilename', () => {
  it('follows audit-<scope>-<yyyy-mm-dd>.<ext>', () => {
    const d = new Date('2026-10-05T12:00:00Z');
    expect(exportFilename('all', 'csv', d)).toBe('audit-all-2026-10-05.csv');
    expect(exportFilename('site-1234abcd', 'json', d)).toBe('audit-site-1234abcd-2026-10-05.json');
  });
});

describe('streamAuditExport', () => {
  it('streams a BOM-prefixed CSV with headers', async () => {
    const { res, chunks, headers } = fakeRes();
    await streamAuditExport(res, [sampleRow()], 'csv', 'audit-all-2026-10-05.csv', false);
    expect(chunks[0].startsWith('\uFEFFtimestamp,site,')).toBe(true);
    expect(chunks[chunks.length - 1]).toBe('<END>');
    expect(headers['Content-Disposition']).toBe('attachment; filename="audit-all-2026-10-05.csv"');
    expect(headers['Content-Type']).toContain('text/csv');
    expect(headers['X-Audit-Export-Rows']).toBe('1');
    expect(headers['X-Audit-Export-Truncated']).toBe('false');
  });

  it('streams valid JSON for several chunks and reports truncation', async () => {
    const rows = Array.from({ length: 1201 }, (_, i) => sampleRow({ id: String(i) }));
    const { res, chunks, headers } = fakeRes();
    await streamAuditExport(res, rows, 'json', 'x.json', true);
    const parsed = JSON.parse(chunks.filter((c) => c !== '<END>').join(''));
    expect(parsed).toHaveLength(1201);
    expect(parsed[0]).toMatchObject({ user: 'a@example.de', operation: 'UPDATE' });
    expect(headers['X-Audit-Export-Truncated']).toBe('true');
  });

  it('writes an empty JSON array for no rows', async () => {
    const { res, chunks } = fakeRes();
    await streamAuditExport(res, [], 'json', 'x.json', false);
    expect(JSON.parse(chunks.filter((c) => c !== '<END>').join(''))).toEqual([]);
  });
});
