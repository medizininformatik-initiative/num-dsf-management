/**
 * admin-cert-expiry.service.test.ts – Which admin certificates get a warning
 * mail today: only the 30/14/7/3/1-day marks, never twice on one day, and not
 * when the same admin already holds another certificate valid beyond that date.
 * Pure function, no DB. Dependencies: admin-cert-expiry.service (db is imported
 * but unused by selectAdminCertWarnings)
 */
import {
  selectAdminCertWarnings,
  type AdminCertExpiryRow,
} from '../services/admin-cert-expiry.service';

const NOW = new Date('2026-10-09T08:00:00Z');
const inDays = (n: number): Date => new Date(Date.UTC(2026, 9, 9 + n, 23, 0, 0));

function row(id: string, email: string, days: number | null, extra = {}): AdminCertExpiryRow {
  return {
    id,
    email,
    subject: `cn-${id}`,
    valid_until: days === null ? null : inDays(days),
    last_warned_at: null,
    ...extra,
  };
}

describe('selectAdminCertWarnings', () => {
  it.each([30, 14, 7, 3, 1])('warns at %i days', (d) => {
    const out = selectAdminCertWarnings([row('a', 'x@y.de', d)], NOW);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'a', email: 'x@y.de', daysLeft: d });
  });

  it.each([0, 2, 5, 29, 31, 90, -1])('stays quiet at %i days', (d) => {
    expect(selectAdminCertWarnings([row('a', 'x@y.de', d)], NOW)).toEqual([]);
  });

  it('skips certificates with unknown expiry', () => {
    expect(selectAdminCertWarnings([row('a', 'x@y.de', null)], NOW)).toEqual([]);
  });

  it('does not warn twice on the same day, but again on a later threshold', () => {
    const warned = row('a', 'x@y.de', 7, { last_warned_at: new Date('2026-10-09T06:00:00Z') });
    expect(selectAdminCertWarnings([warned], NOW)).toEqual([]);
    const earlier = row('a', 'x@y.de', 7, { last_warned_at: new Date('2026-10-02T08:00:00Z') });
    expect(selectAdminCertWarnings([earlier], NOW)).toHaveLength(1);
  });

  it('skips when another certificate of the same admin outlives it', () => {
    const rows = [row('old', 'x@y.de', 7), row('new', 'X@y.de', 300)];
    expect(selectAdminCertWarnings(rows, NOW)).toEqual([]);
  });

  it('still warns when the other certificate expires earlier, is unknown or belongs to someone else', () => {
    const rows = [
      row('a', 'x@y.de', 7),
      row('earlier', 'x@y.de', 2),
      row('unknown', 'x@y.de', null),
      row('theirs', 'z@y.de', 300),
    ];
    expect(selectAdminCertWarnings(rows, NOW).map((w) => w.id)).toEqual(['a']);
  });
});
