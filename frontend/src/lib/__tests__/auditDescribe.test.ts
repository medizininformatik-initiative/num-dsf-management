/**
 * auditDescribe.test.ts – event wording, flag metadata and before/after tables.
 */
import { describe, it, expect } from 'vitest';
import type { AuditEntry } from '../../api/audit.api';
import { en } from '../../i18n/en';
import { de } from '../../i18n/de';
import { FLAG_META, describeEvent, diffTable, parseDiff, topFlag } from '../auditDescribe';

function entry(over: Partial<AuditEntry>): AuditEntry {
  return {
    id: 'e',
    timestamp: '2026-05-01T10:00:00Z',
    user_email: 'a@example.de',
    instance_id: null,
    resource_type: 'AUTH',
    resource_id: null,
    operation: 'CREATE',
    diff_json: null,
    ip_address: null,
    instance_label: null,
    organization_identifier: null,
    organization_name: null,
    ...over,
  };
}

describe('describeEvent', () => {
  it('names the admin promotion target', () => {
    expect(
      describeEvent(entry({ diff_json: { promotion_action: 'REQUEST', target: 'x@example.de' } })),
    ).toEqual({ key: 'auditEv_promotion_REQUEST', vars: { target: 'x@example.de' } });
  });

  it('maps CA list actions and refusals', () => {
    expect(
      describeEvent(entry({ diff_json: { action: 'ca_blacklist_add', subjectDn: 'CN=Bad' } })),
    ).toEqual({ key: 'auditEv_action_ca_blacklist_add', vars: { subjectDn: 'CN=Bad' } });
    expect(
      describeEvent(entry({ operation: 'DENIED', diff_json: { reason: 'PRIVATE_KEY_REJECTED' } }))
        ?.key,
    ).toBe('auditEv_denied_PRIVATE_KEY_REJECTED');
  });

  it('fills the variables of new operations', () => {
    expect(
      describeEvent(entry({ operation: 'EXPORT', diff_json: { format: 'csv', rows: 12 } })),
    ).toEqual({
      key: 'auditEv_op_EXPORT',
      vars: { reason: '—', bucket: '—', format: 'CSV', rows: '12' },
    });
  });

  it('accepts a JSON string and returns null when nothing specific applies', () => {
    expect(
      describeEvent(
        entry({
          diff_json: JSON.stringify({ whitelist_action: 'LOCK', email: 'l@x.de' }) as never,
        }),
      )?.key,
    ).toBe('auditEv_whitelist_LOCK');
    expect(describeEvent(entry({ resource_type: 'CONTACT', operation: 'UPDATE' }))).toBeNull();
  });
});

describe('flag metadata', () => {
  it('has a title and explanation in both languages for every rule', () => {
    for (const meta of Object.values(FLAG_META)) {
      expect(en[meta.title]).toBeTruthy();
      expect(en[meta.explain]).toBeTruthy();
      expect(de[meta.title]).toBeTruthy();
      expect(de[meta.explain]).toBeTruthy();
    }
    expect(Object.keys(FLAG_META)).toHaveLength(11);
  });

  it('picks the most severe flag', () => {
    expect(
      topFlag([
        { code: 'A', severity: 'info' },
        { code: 'B', severity: 'critical' },
        { code: 'C', severity: 'warning' },
      ])?.code,
    ).toBe('B');
    expect(topFlag([])).toBeNull();
    expect(topFlag(undefined)).toBeNull();
  });
});

describe('diffTable', () => {
  it('builds a before/after table with only the changed fields', () => {
    const t = diffTable({
      before: { name: 'Old', city: 'Muenster' },
      after: { name: 'New', city: 'Muenster' },
    });
    expect(t).toEqual({ kind: 'change', rows: [{ field: 'name', before: 'Old', after: 'New' }] });
  });

  it('lists every field of a creation as before — / after value', () => {
    const t = diffTable({ after: { name: 'Klinik', active: true } });
    expect(t?.kind).toBe('change');
    expect(t?.rows).toEqual([
      { field: 'name', before: '—', after: 'Klinik' },
      { field: 'active', before: '—', after: 'true' },
    ]);
  });

  it('falls back to a field/value table and renders nested values as JSON', () => {
    const t = diffTable({ reason: 'X', ids: [1, 2] });
    expect(t).toEqual({
      kind: 'values',
      rows: [
        { field: 'reason', value: 'X' },
        { field: 'ids', value: '[1,2]' },
      ],
    });
  });

  it('returns null for an empty or malformed diff', () => {
    expect(diffTable(null)).toBeNull();
    expect(diffTable({})).toBeNull();
    expect(parseDiff('not json')).toEqual({});
  });
});
