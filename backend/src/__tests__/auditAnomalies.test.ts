/**
 * auditAnomalies.test.ts – pure unit tests for the audit anomaly rules.
 * Dependencies: services/auditAnomalies
 */
import {
  FAILED_BURST_CRITICAL,
  FAILED_BURST_THRESHOLD,
  MASS_DELETE_THRESHOLD,
  berlinHour,
  computeAnomalyFlags,
  isOffHours,
  summarizeAnomalies,
  type AnomalyRow,
} from '../services/auditAnomalies';

let seq = 0;
// 2026-03-10 is a Tuesday, CET (UTC+1): 10:00 UTC = 11:00 Berlin (office hours).
const BASE = Date.parse('2026-03-10T10:00:00Z');

function row(over: Partial<AnomalyRow> & { offsetSec?: number }): AnomalyRow {
  seq += 1;
  return {
    id: `r${seq}`,
    timestamp: new Date(BASE + (over.offsetSec ?? 0) * 1000),
    user_email: 'a@example.de',
    ip_address: '10.0.0.1',
    resource_type: 'AUTH',
    operation: 'LOGIN',
    diff_json: null,
    ...over,
  };
}

function codes(flags: Map<string, unknown[]>, id: string): string[] {
  return ((flags.get(id) ?? []) as Array<{ code: string }>).map((f) => f.code);
}

describe('auditAnomalies', () => {
  it('flags nothing for ordinary office-hours activity', () => {
    const rows = [row({ operation: 'CREATE', resource_type: 'CONTACT' }), row({})];
    expect(computeAnomalyFlags(rows).size).toBe(0);
  });

  describe('failed sign-in bursts', () => {
    it('flags a burst per e-mail as warning', () => {
      const rows = Array.from({ length: FAILED_BURST_THRESHOLD }, (_, i) =>
        row({ operation: 'FAILED_LOGIN', offsetSec: i * 10, ip_address: `10.0.0.${i}` }),
      );
      const flags = computeAnomalyFlags(rows);
      for (const r of rows) {
        expect(flags.get(r.id)).toEqual([{ code: 'FAILED_AUTH_BURST', severity: 'warning' }]);
      }
    });

    it('flags a burst per IP even when the e-mail changes', () => {
      const rows = Array.from({ length: FAILED_BURST_THRESHOLD }, (_, i) =>
        row({ operation: 'FAILED_LOGIN', offsetSec: i, user_email: `u${i}@example.de` }),
      );
      expect(codes(computeAnomalyFlags(rows), rows[0].id)).toContain('FAILED_AUTH_BURST');
    });

    it('escalates a large burst to critical', () => {
      const rows = Array.from({ length: FAILED_BURST_CRITICAL }, (_, i) =>
        row({ operation: 'STEP_UP_FAILED', offsetSec: i }),
      );
      const flag = computeAnomalyFlags(rows)
        .get(rows[0].id)
        ?.find((f) => f.code === 'FAILED_AUTH_BURST');
      expect(flag?.severity).toBe('critical');
    });

    it('does not flag failures spread over more than the window', () => {
      const rows = Array.from({ length: FAILED_BURST_THRESHOLD }, (_, i) =>
        row({ operation: 'FAILED_LOGIN', offsetSec: i * 600 }),
      );
      expect(codes(computeAnomalyFlags(rows), rows[0].id)).not.toContain('FAILED_AUTH_BURST');
    });

    it('accepts timestamps as ISO strings', () => {
      const rows = Array.from({ length: FAILED_BURST_THRESHOLD }, (_, i) =>
        row({
          operation: 'FAILED_LOGIN',
          timestamp: new Date(BASE + i * 1000).toISOString(),
        }),
      );
      expect(codes(computeAnomalyFlags(rows), rows[0].id)).toContain('FAILED_AUTH_BURST');
    });
  });

  describe('denied actions', () => {
    it('flags a rejected private-key upload as critical', () => {
      const r = row({
        resource_type: 'CERTIFICATE',
        operation: 'DENIED',
        diff_json: { reason: 'PRIVATE_KEY_REJECTED' },
      });
      expect(computeAnomalyFlags([r]).get(r.id)).toEqual([
        { code: 'PRIVATE_KEY_REJECTED', severity: 'critical' },
      ]);
    });

    it('flags non-whitelisted and blacklisted issuers', () => {
      const w = row({
        resource_type: 'CERTIFICATE',
        operation: 'DENIED',
        diff_json: JSON.stringify({ reason: 'CA_NOT_WHITELISTED' }),
      });
      const b = row({
        resource_type: 'CERTIFICATE',
        operation: 'DENIED',
        diff_json: { reason: 'CA_BLACKLISTED' },
      });
      const flags = computeAnomalyFlags([w, b]);
      expect(flags.get(w.id)?.[0]).toEqual({ code: 'CA_NOT_WHITELISTED', severity: 'warning' });
      expect(flags.get(b.id)?.[0]).toEqual({ code: 'CA_BLACKLISTED', severity: 'critical' });
    });

    it('flags four-eyes violations on approvals', () => {
      const r = row({
        resource_type: 'APPROVAL',
        operation: 'DENIED',
        diff_json: { reason: 'ALREADY_APPROVED_SAME_SITE' },
      });
      expect(codes(computeAnomalyFlags([r]), r.id)).toContain('APPROVAL_DENIED');
    });
  });

  it('flags rate-limit hits and single step-up failures', () => {
    const rl = row({ operation: 'RATE_LIMITED' });
    const su = row({
      operation: 'STEP_UP_FAILED',
      user_email: 'other@example.de',
      ip_address: '1',
    });
    const flags = computeAnomalyFlags([rl, su]);
    expect(flags.get(rl.id)?.[0]).toEqual({ code: 'RATE_LIMITED', severity: 'warning' });
    expect(flags.get(su.id)?.[0]).toEqual({ code: 'STEP_UP_FAILED', severity: 'info' });
  });

  describe('mass deletes', () => {
    it('flags many deletes by one actor in a short window', () => {
      const rows = Array.from({ length: MASS_DELETE_THRESHOLD }, (_, i) =>
        row({ operation: 'DELETE', resource_type: 'CONTACT', offsetSec: i * 5 }),
      );
      expect(codes(computeAnomalyFlags(rows), rows[0].id)).toContain('MASS_DELETE');
    });

    it('does not flag deletes by different actors', () => {
      const rows = Array.from({ length: MASS_DELETE_THRESHOLD }, (_, i) =>
        row({ operation: 'DELETE', resource_type: 'CONTACT', user_email: `u${i}@example.de` }),
      );
      expect(computeAnomalyFlags(rows).size).toBe(0);
    });
  });

  describe('admin changes', () => {
    it('marks CA list changes as info', () => {
      const r = row({
        resource_type: 'CERTIFICATE',
        operation: 'CREATE',
        diff_json: { action: 'ca_whitelist_add', subjectDn: 'CN=x' },
      });
      expect(computeAnomalyFlags([r]).get(r.id)).toEqual([
        { code: 'CA_LIST_CHANGE', severity: 'info' },
      ]);
    });

    it('marks promotions as admin changes, an approval as warning', () => {
      const req = row({ operation: 'CREATE', diff_json: { promotion_action: 'REQUEST' } });
      const ok = row({ operation: 'APPROVE', diff_json: { promotion_action: 'APPROVE' } });
      const flags = computeAnomalyFlags([req, ok]);
      expect(flags.get(req.id)?.[0]).toEqual({ code: 'ADMIN_CHANGE', severity: 'info' });
      expect(flags.get(ok.id)?.[0]).toEqual({ code: 'ADMIN_CHANGE', severity: 'warning' });
    });
  });

  describe('office hours (Europe/Berlin)', () => {
    it('computes the Berlin hour across DST', () => {
      expect(berlinHour(new Date('2026-01-15T21:30:00Z'))).toBe(22); // CET, UTC+1
      expect(berlinHour(new Date('2026-07-15T21:30:00Z'))).toBe(23); // CEST, UTC+2
    });

    it('treats 22:00-06:00 as off hours', () => {
      expect(isOffHours(new Date('2026-01-15T21:00:00Z'))).toBe(true); // 22:00
      expect(isOffHours(new Date('2026-01-15T04:59:00Z'))).toBe(true); // 05:59
      expect(isOffHours(new Date('2026-01-15T05:00:00Z'))).toBe(false); // 06:00
      expect(isOffHours(new Date('2026-01-15T20:59:00Z'))).toBe(false); // 21:59
    });

    it('flags admin actions at night but not ordinary edits or logins', () => {
      const night = new Date('2026-01-15T23:30:00Z'); // 00:30 Berlin
      const approval = row({ resource_type: 'APPROVAL', operation: 'APPROVE', timestamp: night });
      const contact = row({ resource_type: 'CONTACT', operation: 'UPDATE', timestamp: night });
      const login = row({ resource_type: 'AUTH', operation: 'LOGIN', timestamp: night });
      const flags = computeAnomalyFlags([approval, contact, login]);
      expect(codes(flags, approval.id)).toContain('OFF_HOURS_ADMIN');
      expect(flags.has(contact.id)).toBe(false);
      expect(flags.has(login.id)).toBe(false);
    });
  });

  it('keeps the most severe flag first and summarises by it', () => {
    const r = row({
      resource_type: 'APPROVAL',
      operation: 'DENIED',
      diff_json: { reason: 'PRIVATE_KEY_REJECTED' },
      timestamp: new Date('2026-01-15T23:30:00Z'),
    });
    const info = row({
      operation: 'CREATE',
      diff_json: { action: 'ca_blacklist_add' },
      user_email: 'b@example.de',
    });
    const flags = computeAnomalyFlags([r, info]);
    expect(flags.get(r.id)?.[0].severity).toBe('critical');
    expect(summarizeAnomalies(flags, 2)).toEqual({
      info: 1,
      warning: 0,
      critical: 1,
      flagged: 2,
      scanned: 2,
    });
  });
});
