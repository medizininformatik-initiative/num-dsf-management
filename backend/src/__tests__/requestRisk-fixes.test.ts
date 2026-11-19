/**
 * requestRisk-fixes.test.ts – Certificate facts kept in the snapshot, replacement pairing,
 * subject changes, endpoint URL rules, IP normalisation, takeover variants, mitigation cap and
 * unreadable snapshots of the pure request-risk assessment.
 * Dependencies: lib/requestRisk, lib/requestRiskSupport, helpers/requestRiskFixtures
 */
import { assessRequest, type RiskInput } from '../lib/requestRisk';
import { commonName, splitDn } from '../lib/requestRiskSupport';
import {
  codes,
  ctx,
  DAY,
  GEANT,
  NOW,
  ORG,
  R11,
  run,
  snap,
  type SnapSpec,
} from './helpers/requestRiskFixtures';

const keep = { id: `dsf.${ORG}`, ips: ['93.184.216.34'] };

describe('certificate facts stored in the snapshot', () => {
  it('rates a renewal LOW from embedded facts alone (old row gone)', () => {
    const r = run({
      current: { certs: [{ id: 'new', days: 365, embed: true }] },
      previous: { certs: [{ id: 'old', days: 12, embed: true }] },
      noDb: true,
    });
    expect(codes(r)).toEqual(['CERT_RENEWAL']);
    expect(r.level).toBe('LOW');
  });

  it('still sees a CA swap when the old certificate row is gone', () => {
    const r = run({
      current: { certs: [{ id: 'new', days: 365, embed: true, issuer: R11 }] },
      previous: { certs: [{ id: 'old', days: 12, embed: true }] },
      caStatus: { [GEANT]: 'whitelisted', [R11]: 'whitelisted' },
      noDb: true,
    });
    expect(codes(r)).toContain('CERT_ISSUER_CHANGED');
    expect(codes(r)).not.toContain('CERT_RENEWAL');
    expect(r.level).toBe('MEDIUM');
  });

  it('is not a renewal when the old issuer is unknown (legacy snapshot, row gone)', () => {
    const r = run({
      current: { certs: [{ id: 'new', days: 365, embed: true }] },
      previous: { certs: [{ id: 'old', days: 12 }] },
      noDb: true,
    });
    expect(codes(r)).toContain('CERT_NOT_COMPARABLE');
    expect(codes(r)).not.toContain('CERT_RENEWAL');
  });

  it('is not a renewal when the old expiry is unknown', () => {
    const previous = snap({ certs: [{ id: 'old', days: 12, embed: true }] });
    delete (previous.certificates[0] as Record<string, unknown>).valid_until;
    delete (previous.certificates[0] as Record<string, unknown>).notAfter;
    const input: RiskInput = {
      current: snap({ certs: [{ id: 'new', days: 365, embed: true }] }),
      previous,
      certInfo: {},
      caStatus: { [GEANT]: 'whitelisted' },
      context: ctx(),
    };
    const r = assessRequest(input);
    expect(codes(r)).toContain('CERT_NOT_COMPARABLE');
    expect(codes(r)).not.toContain('CERT_RENEWAL');
  });

  it('does not compare with a previous snapshot whose certificates have no thumbprint', () => {
    const previous = snap({ certs: [{ id: 'old', days: 300 }] });
    (previous.certificates[0] as Record<string, unknown>).thumbprint = '';
    const r = assessRequest({
      current: snap({ certs: [{ id: 'new', days: 365 }] }),
      previous,
      certInfo: {},
      caStatus: {},
      context: ctx(),
    });
    expect(codes(r)).toContain('CERT_NOT_COMPARABLE');
    expect(codes(r)).not.toContain('CERT_EARLY_REPLACE');
  });
});

describe('replacement pairing and subject changes', () => {
  it('a different subject is CERT_SUBJECT_CHANGED with both names', () => {
    const r = run({
      current: { certs: [{ id: 'new', days: 365, cn: `fhir.${ORG}` }] },
      previous: { certs: [{ id: 'old', days: 12 }] },
    });
    expect(codes(r)).toEqual(['CERT_SUBJECT_CHANGED']);
    expect(r.findings[0].params).toEqual({ from: `dsf.${ORG}`, to: `fhir.${ORG}` });
    expect(r.level).toBe('MEDIUM');
  });

  it('the renewal of two certificates is not CERT_ALL_REPLACED', () => {
    const r = run({
      current: {
        certs: [
          { id: 'n1', days: 300, cn: `a.${ORG}` },
          { id: 'n2', days: 300, cn: `b.${ORG}` },
        ],
      },
      previous: {
        certs: [
          { id: 'o1', days: 10, cn: `a.${ORG}` },
          { id: 'o2', days: 10, cn: `b.${ORG}` },
        ],
      },
    });
    expect(codes(r)).toEqual(['CERT_RENEWAL', 'CERT_RENEWAL']);
    expect(r.level).toBe('LOW');
  });

  it('pairs by subject, whatever order the snapshot lists the certificates in', () => {
    const a = { id: 'a', days: 10, cn: `a.${ORG}` };
    const b = { id: 'b', days: 10, cn: `b.${ORG}` };
    const fwd = run({
      current: {
        certs: [
          { ...a, id: 'a2', days: 300 },
          { ...b, id: 'b2', days: 300 },
        ],
      },
      previous: { certs: [a, b] },
    });
    const rev = run({
      current: {
        certs: [
          { ...b, id: 'b2', days: 300 },
          { ...a, id: 'a2', days: 300 },
        ],
      },
      previous: { certs: [b, a] },
    });
    for (const r of [fwd, rev]) {
      expect(codes(r)).toEqual(['CERT_RENEWAL', 'CERT_RENEWAL']);
      expect(r.findings.map((f) => f.params.cn).sort()).toEqual([`a.${ORG}`, `b.${ORG}`]);
    }
  });
});

describe('new certificate expiry', () => {
  it('an already expired new certificate is medium, a short-lived one low', () => {
    const expired = run({
      current: { certs: [{ id: 'new', days: -2 }] },
      previous: { certs: [{ id: 'old', days: 12 }] },
    });
    expect(expired.findings.find((f) => f.code === 'CERT_EXPIRED')).toMatchObject({
      severity: 'medium',
      weight: 2,
    });
    const short = run({
      current: { certs: [{ id: 'new', days: 20 }] },
      previous: { certs: [{ id: 'old', days: 12 }] },
    });
    expect(short.findings.find((f) => f.code === 'CERT_SHORT_VALIDITY')).toMatchObject({
      severity: 'low',
      weight: 1,
    });
  });
});

describe('endpoint addresses', () => {
  const addr = (address: string): SnapSpec => ({ endpoints: [{ ...keep, address }] });
  const base = addr(`https://dsf.${ORG}/fhir`);

  it('a scheme downgrade is medium', () => {
    const r = run({ current: addr(`http://dsf.${ORG}/fhir`), previous: base });
    expect(codes(r)).toEqual(['ENDPOINT_SCHEME_DOWNGRADE']);
    expect(r.level).toBe('MEDIUM');
  });

  it('a port or path change is low', () => {
    const port = run({ current: addr(`https://dsf.${ORG}:8443/fhir`), previous: base });
    expect(codes(port)).toEqual(['ENDPOINT_URL_CHANGED']);
    const path = run({ current: addr(`https://dsf.${ORG}/other`), previous: base });
    expect(codes(path)).toEqual(['ENDPOINT_URL_CHANGED']);
    expect(port.level).toBe('LOW');
  });

  it('an unreadable address is medium', () => {
    const r = run({ current: addr('not a url'), previous: base });
    expect(codes(r)).toEqual(['ENDPOINT_ADDRESS_UNREADABLE']);
    expect(r.level).toBe('MEDIUM');
  });

  it('ignores case, a trailing dot and a trailing slash', () => {
    const r = run({ current: addr(`HTTPS://DSF.${ORG.toUpperCase()}./fhir/`), previous: base });
    expect(codes(r)).not.toContain('ENDPOINT_ADDRESS_CHANGED');
    expect(codes(r)).not.toContain('ENDPOINT_URL_CHANGED');
  });

  it('a host under a second-level public suffix is a foreign domain', () => {
    const r = run({ current: addr('https://dsf.evil.ac.uk/fhir'), previous: base });
    expect(codes(r)).toContain('ENDPOINT_FOREIGN_DOMAIN');
  });
});

describe('IP addresses', () => {
  it('IP_ADDED when an endpoint without IPs gets some', () => {
    const r = run({
      current: { endpoints: [{ id: keep.id, ips: ['93.184.216.34'] }] },
      previous: { endpoints: [{ id: keep.id, ips: [] }] },
    });
    expect(codes(r)).toEqual(['IP_ADDED']);
  });

  it('compares IPv6 and IPv4-mapped addresses in canonical form', () => {
    const r = run({
      current: {
        endpoints: [{ id: keep.id, ips: ['2001:0db8:0:0:0:0:0:1', '::ffff:93.184.216.34'] }],
      },
      previous: { endpoints: [{ id: keep.id, ips: ['2001:db8::1', '93.184.216.34'] }] },
    });
    expect(codes(r)).not.toContain('IP_ADDED');
    expect(codes(r)).not.toContain('IP_REPLACED_ALL');
  });

  it('reports shared IPs once, with a count and the other organizations', () => {
    const r = run({
      current: {
        endpoints: [{ id: keep.id, ips: ['93.184.216.34', '93.184.216.71', '93.184.216.72'] }],
      },
      previous: {},
      context: {
        otherOrgsByIp: {
          '93.184.216.71': ['a.example.de'],
          '93.184.216.72': ['a.example.de', 'b.example.de'],
        },
      },
    });
    const shared = r.findings.filter((f) => f.code === 'IP_SHARED');
    expect(shared).toHaveLength(1);
    expect(shared[0].params).toEqual({ n: 2, orgs: 'a.example.de, b.example.de' });
  });

  it('flags a private address written in an unusual form', () => {
    const r = run({
      current: { endpoints: [{ id: keep.id, ips: ['93.184.216.34', '0:0:0:0:0:ffff:a00:1'] }] },
      previous: {},
    });
    expect(codes(r)).toContain('IP_PRIVATE');
  });
});

describe('contacts and memberships', () => {
  it('CONTACTS_ALL_REPLACED together with a certificate change is a takeover', () => {
    const r = run({
      current: { certs: [{ id: 'new', days: 365 }], contacts: [{ id: 'n1', validated: true }] },
      previous: { certs: [{ id: 'old', days: 100 }], contacts: [{ id: 'o1' }] },
    });
    expect(codes(r)).toContain('TAKEOVER_PATTERN');
    expect(r.level).toBe('HIGH');
  });

  it('hints that contact data cannot be compared without a digest on both sides', () => {
    const r = run({ current: { digest: null }, previous: {} });
    expect(r.findings.find((f) => f.code === 'CONTACT_DATA_NOT_COMPARABLE')).toMatchObject({
      severity: 'info',
    });
  });

  it('a contact gaining DSF_ADMIN is CONTACT_ROLE_CHANGED', () => {
    const r = run({
      current: { contacts: [{ id: 'c1', types: ['DSF_ADMIN', 'MEDIC'], validated: true }] },
      previous: { contacts: [{ id: 'c1', types: ['MEDIC'] }] },
    });
    expect(codes(r)).toEqual(['CONTACT_ROLE_CHANGED']);
  });

  it('compares the parent organization case-insensitively', () => {
    const r = run({
      current: { memberships: [{ parent: 'NUM.de', roles: ['DIC'] }] },
      previous: { memberships: [{ parent: 'num.de', roles: ['DIC'] }] },
    });
    expect(codes(r)).toEqual([]);
  });
});

describe('DN parsing', () => {
  it('keeps escaped commas inside a value', () => {
    expect(splitDn('C=DE,O=Muster\\, Klinik,CN=R11')).toEqual([
      'C=DE',
      'O=Muster\\, Klinik',
      'CN=R11',
    ]);
    expect(commonName('C=DE,CN=Muster\\, Klinik GmbH,O=x')).toBe('Muster, Klinik GmbH');
    expect(commonName('CN="a, b",O=x')).toBe('a, b');
    expect(commonName('O=NoCommonName')).toBe('O=NoCommonName');
  });
});

describe('mitigation cap', () => {
  const renewal = {
    current: { certs: [{ id: 'new', days: 365 }] },
    previous: { certs: [{ id: 'old', days: 12 }] },
  };

  it('keeps the -1 next to low findings only', () => {
    const r = run({ ...renewal, context: { rejectedLast30d: 1 } });
    expect(r.findings.find((f) => f.code === 'CERT_RENEWAL')?.weight).toBe(-1);
    expect(r.score).toBe(0);
    expect(r.level).toBe('LOW');
  });

  it('withdraws the mitigation next to a medium finding and never lowers the level', () => {
    const r = run({
      current: { ...renewal.current, name: 'Renamed' },
      previous: renewal.previous,
    });
    expect(r.findings.find((f) => f.code === 'CERT_RENEWAL')?.weight).toBe(0);
    expect(r.score).toBe(2);
    expect(r.level).toBe('MEDIUM');
  });

  it('withdraws the mitigation when the request comes from a new IP', () => {
    const r = run({
      ...renewal,
      context: { submitterIp: '203.0.113.9', knownSubmitIps: ['198.51.100.1'] },
    });
    expect(r.findings.find((f) => f.code === 'CERT_RENEWAL')?.weight).toBe(0);
    expect(codes(r)).toContain('NEW_SUBMIT_IP');
  });

  it('RECENT_REJECTIONS is a low finding', () => {
    const r = run({ current: {}, previous: {}, context: { rejectedLast30d: 2 } });
    expect(r.findings.find((f) => f.code === 'RECENT_REJECTIONS')).toMatchObject({
      severity: 'low',
      weight: 1,
    });
    expect(r.level).toBe('LOW');
  });
});

describe('split takeover', () => {
  const earlierContacts: SnapSpec = { digest: 'd0' };
  const resolved = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * DAY);

  it('a certificate change within 30 days after a contact change is a takeover', () => {
    const r = run({
      current: { certs: [{ id: 'new', days: 365 }] },
      previous: { certs: [{ id: 'old', days: 100 }] },
      beforePrevious: earlierContacts,
      previousResolvedAt: resolved(10),
    });
    const t = r.findings.find((f) => f.code === 'TAKEOVER_PATTERN');
    expect(t?.params).toEqual({ after: 'contact', days: 10 });
    expect(r.level).toBe('HIGH');
  });

  it('also after an endpoint change', () => {
    const r = run({
      current: { certs: [{ id: 'new', days: 365 }] },
      previous: { certs: [{ id: 'old', days: 100 }] },
      beforePrevious: { endpoints: [{ ...keep, address: 'https://old.ukm.de/fhir' }] },
      previousResolvedAt: resolved(5),
    });
    expect(r.findings.find((f) => f.code === 'TAKEOVER_PATTERN')?.params.after).toBe('endpoint');
  });

  it('a routine renewal from a new IP right after a contact change counts too', () => {
    const r = run({
      current: { certs: [{ id: 'new', days: 365 }] },
      previous: { certs: [{ id: 'old', days: 12 }] },
      beforePrevious: earlierContacts,
      previousResolvedAt: resolved(3),
      context: { submitterIp: '203.0.113.9', knownSubmitIps: ['198.51.100.1'] },
    });
    expect(codes(r)).toContain('TAKEOVER_PATTERN');
  });

  it('does not fire for a plain renewal, after 30 days, or without an earlier change', () => {
    const renewal = {
      current: { certs: [{ id: 'new', days: 365 }] },
      previous: { certs: [{ id: 'old', days: 12 }] },
    };
    expect(
      codes(run({ ...renewal, beforePrevious: earlierContacts, previousResolvedAt: resolved(3) })),
    ).not.toContain('TAKEOVER_PATTERN');
    const early = {
      current: { certs: [{ id: 'new', days: 365 }] },
      previous: { certs: [{ id: 'old', days: 100 }] },
    };
    expect(
      codes(run({ ...early, beforePrevious: earlierContacts, previousResolvedAt: resolved(31) })),
    ).not.toContain('TAKEOVER_PATTERN');
    expect(
      codes(run({ ...early, beforePrevious: {}, previousResolvedAt: resolved(3) })),
    ).not.toContain('TAKEOVER_PATTERN');
  });
});

describe('unreadable snapshots', () => {
  it.each([[{}], ['{not json'], [null]])('%j gives one high SNAPSHOT_UNREADABLE finding', (raw) => {
    const r = assessRequest({
      current: raw,
      previous: snap(),
      certInfo: {},
      caStatus: {},
      context: ctx(),
    });
    expect(codes(r)).toEqual(['SNAPSHOT_UNREADABLE']);
    expect(r.level).toBe('HIGH');
    expect(r.firstRequest).toBe(false);
  });

  it('treats an unreadable previous snapshot as no usable previous approval', () => {
    const r = assessRequest({
      current: snap(),
      previous: {},
      certInfo: {},
      caStatus: {},
      context: ctx(),
    });
    expect(r.firstRequest).toBe(true);
  });
});
