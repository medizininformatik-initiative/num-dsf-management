/**
 * requestRisk-rules.test.ts – Endpoint, organization, contact, membership, context and combination rules plus first requests.
 * Dependencies: lib/requestRisk, helpers/requestRiskFixtures
 */
import type { RiskContext } from '../lib/requestRisk';
import { codes, R11, ORG, run } from './helpers/requestRiskFixtures';

describe('endpoint rules', () => {
  const keep = { id: `dsf.${ORG}`, ips: ['93.184.216.34'] };

  it('an address change to another host is ENDPOINT_ADDRESS_CHANGED', () => {
    const r = run({
      current: { endpoints: [{ ...keep, address: `https://fhir.${ORG}/fhir` }] },
      previous: {},
    });
    expect(codes(r)).toEqual(['ENDPOINT_ADDRESS_CHANGED']);
    expect(r.findings[0].params).toEqual({ from: `dsf.${ORG}`, to: `fhir.${ORG}` });
  });

  it('a new host on a foreign domain is ENDPOINT_FOREIGN_DOMAIN', () => {
    const r = run({
      current: { endpoints: [{ ...keep, address: 'https://dsf.evil.org/fhir' }] },
      previous: {},
    });
    expect(codes(r)).toEqual(
      ['ENDPOINT_ADDRESS_CHANGED', 'ENDPOINT_FOREIGN_DOMAIN'].sort().reverse(),
    );
    expect(r.level).toBe('HIGH');
  });

  it('a host on a previously approved foreign domain is not foreign', () => {
    const r = run({
      current: { endpoints: [{ ...keep, address: 'https://b.hospital.org/fhir' }] },
      previous: { endpoints: [{ ...keep, address: 'https://a.hospital.org/fhir' }] },
    });
    expect(codes(r)).not.toContain('ENDPOINT_FOREIGN_DOMAIN');
  });

  it('adds and removes endpoints', () => {
    const added = run({
      current: { endpoints: [keep, { id: `dsf2.${ORG}`, ips: ['93.184.216.35'] }] },
      previous: {},
    });
    expect(codes(added)).toEqual(['ENDPOINT_ADDED']);
    const removed = run({
      current: { endpoints: [keep] },
      previous: { endpoints: [keep, { id: `dsf2.${ORG}`, ips: ['93.184.216.35'] }] },
    });
    expect(codes(removed)).toEqual(['ENDPOINT_REMOVED']);
    expect(removed.level).toBe('MEDIUM');
  });

  it('IP_ADDED when an IP joins, IP_REPLACED_ALL when none remains', () => {
    const added = run({
      current: { endpoints: [{ id: keep.id, ips: ['93.184.216.34', '93.184.216.40'] }] },
      previous: {},
    });
    expect(codes(added)).toEqual(['IP_ADDED']);
    const replaced = run({
      current: { endpoints: [{ id: keep.id, ips: ['93.184.216.99'] }] },
      previous: {},
    });
    expect(codes(replaced)).toEqual(['IP_REPLACED_ALL']);
  });

  it.each([
    '10.0.0.5',
    '172.16.3.4',
    '192.168.1.1',
    '127.0.0.1',
    '169.254.1.1',
    '100.64.0.9',
    '0.1.2.3',
    'fd12::1',
    'fe80::1',
    '::1',
  ])('IP_PRIVATE for %s', (ip) => {
    const r = run({
      current: { endpoints: [{ id: keep.id, ips: ['93.184.216.34', ip] }] },
      previous: {},
    });
    expect(codes(r)).toContain('IP_PRIVATE');
  });

  it('does not flag public addresses as private', () => {
    const r = run({
      current: {
        endpoints: [{ id: keep.id, ips: ['93.184.216.34', '172.32.0.1', '2001:db8::1'] }],
      },
      previous: {},
    });
    expect(codes(r)).not.toContain('IP_PRIVATE');
  });

  it('IP_SHARED names the other organization', () => {
    const r = run({
      current: { endpoints: [{ id: keep.id, ips: ['93.184.216.34', '93.184.216.77'] }] },
      previous: {},
      context: { otherOrgsByIp: { '93.184.216.77': ['other.example.de'] } },
    });
    const f = r.findings.find((x) => x.code === 'IP_SHARED');
    expect(f?.params).toEqual({ n: 1, orgs: 'other.example.de' });
  });
});

describe('organization and contact rules', () => {
  it('ORG_NAME_CHANGED and ORG_DEACTIVATED', () => {
    const r = run({ current: { name: 'New', active: false }, previous: {} });
    expect(codes(r).sort()).toEqual(['ORG_DEACTIVATED', 'ORG_NAME_CHANGED']);
    expect(r.findings.find((f) => f.code === 'ORG_NAME_CHANGED')?.params).toEqual({
      from: 'UKM',
      to: 'New',
    });
  });

  it('CONTACT_DATA_CHANGED when the digest differs and both carry one', () => {
    expect(codes(run({ current: { digest: 'd2' }, previous: {} }))).toEqual([
      'CONTACT_DATA_CHANGED',
    ]);
    expect(codes(run({ current: { digest: 'd2' }, previous: { digest: null } }))).not.toContain(
      'CONTACT_DATA_CHANGED',
    );
  });

  it('CONTACTS_ALL_REPLACED when no previous contact remains', () => {
    const r = run({
      current: { contacts: [{ id: 'n1', validated: true }] },
      previous: { contacts: [{ id: 'o1' }] },
    });
    expect(codes(r)).toContain('CONTACTS_ALL_REPLACED');
  });

  it('CONTACT_UNVALIDATED for a new unvalidated DSF_ADMIN contact', () => {
    const r = run({
      current: {
        contacts: [
          { id: 'c1', validated: true },
          { id: 'c2', types: ['DSF_ADMIN'], validated: false },
        ],
      },
      previous: {},
    });
    expect(codes(r)).toEqual(['CONTACT_UNVALIDATED']);
  });

  it('does not flag an unvalidated contact that was already approved', () => {
    const spec = { contacts: [{ id: 'c1', validated: false }] };
    expect(codes(run({ current: spec, previous: spec }))).not.toContain('CONTACT_UNVALIDATED');
  });
});

describe('membership rules', () => {
  it('MEMBERSHIP_NEW_PARENT, MEMBERSHIP_ROLE_ADDED and MEMBERSHIP_REMOVED', () => {
    const newParent = run({
      current: {
        memberships: [
          { parent: 'num.de', roles: ['DIC'] },
          { parent: 'mii.de', roles: ['DIC'] },
        ],
      },
      previous: {},
    });
    expect(codes(newParent)).toEqual(['MEMBERSHIP_NEW_PARENT']);
    const role = run({
      current: { memberships: [{ parent: 'num.de', roles: ['DIC', 'HRP'] }] },
      previous: {},
    });
    expect(codes(role)).toEqual(['MEMBERSHIP_ROLE_ADDED']);
    const removed = run({
      current: { memberships: [] },
      previous: {},
    });
    expect(codes(removed)).toEqual(['MEMBERSHIP_REMOVED']);
  });
});

describe('context rules', () => {
  it('RECENT_REJECTIONS and RECENT_WITHDRAWALS', () => {
    const r = run({
      current: {},
      previous: {},
      context: { rejectedLast30d: 1, withdrawnLast30d: 2 },
    });
    expect(codes(r)).toEqual(expect.arrayContaining(['RECENT_REJECTIONS', 'RECENT_WITHDRAWALS']));
    expect(
      run({ current: {}, previous: {}, context: { withdrawnLast30d: 1 } }).findings.map(
        (f) => f.code,
      ),
    ).not.toContain('RECENT_WITHDRAWALS');
  });

  it('NEW_SUBMIT_IP only when both the submitter and the known IPs are known', () => {
    const c = (over: Partial<RiskContext>) =>
      codes(run({ current: {}, previous: {}, context: over }));
    expect(c({ submitterIp: '1.1.1.1', knownSubmitIps: ['2.2.2.2'] })).toContain('NEW_SUBMIT_IP');
    expect(c({ submitterIp: '2.2.2.2', knownSubmitIps: ['2.2.2.2'] })).not.toContain(
      'NEW_SUBMIT_IP',
    );
    expect(c({ submitterIp: '1.1.1.1', knownSubmitIps: [] })).not.toContain('NEW_SUBMIT_IP');
    expect(c({ submitterIp: null, knownSubmitIps: ['2.2.2.2'] })).not.toContain('NEW_SUBMIT_IP');
  });
});

describe('combinations', () => {
  it('certificate change plus contact data change is a TAKEOVER_PATTERN (HIGH)', () => {
    const r = run({
      current: { certs: [{ id: 'new', days: 365 }], digest: 'd2' },
      previous: { certs: [{ id: 'old', days: 70 }] },
    });
    expect(codes(r)).toEqual(
      expect.arrayContaining(['CERT_EARLY_REPLACE', 'CONTACT_DATA_CHANGED', 'TAKEOVER_PATTERN']),
    );
    expect(r.level).toBe('HIGH');
  });

  it('a pure renewal together with changed contact data is not a takeover', () => {
    const r = run({
      current: { certs: [{ id: 'new', days: 365 }], digest: 'd2' },
      previous: { certs: [{ id: 'old', days: 12 }] },
    });
    expect(codes(r)).not.toContain('TAKEOVER_PATTERN');
  });

  it('certificate change plus a changed endpoint address is a takeover too', () => {
    const r = run({
      current: {
        certs: [{ id: 'new', days: 365 }],
        endpoints: [{ id: `dsf.${ORG}`, address: `https://fhir.${ORG}/x`, ips: ['93.184.216.34'] }],
      },
      previous: { certs: [{ id: 'old', days: 70 }] },
    });
    expect(codes(r)).toContain('TAKEOVER_PATTERN');
  });
});

describe('first request', () => {
  it('has no previous approval: firstRequest, diff rules skipped', () => {
    const r = run({ current: { name: 'Anything' }, previous: null });
    expect(r.firstRequest).toBe(true);
    expect(codes(r)).toContain('FIRST_REQUEST');
    expect(codes(r)).not.toContain('ORG_NAME_CHANGED');
    expect(codes(r)).not.toContain('NOTHING_CHANGED');
  });

  it('still runs the CA, subject, private-IP, shared-IP and foreign-domain checks', () => {
    const r = run({
      current: {
        certs: [{ id: 'c', days: 300, cn: 'dsf.other.net', issuer: R11 }],
        endpoints: [
          {
            id: 'dsf.evil.org',
            address: 'https://dsf.evil.org/fhir',
            ips: ['10.0.0.1', '93.184.216.9'],
          },
        ],
      },
      previous: null,
      caStatus: { [R11]: 'unknown' },
      context: { otherOrgsByIp: { '93.184.216.9': ['x.de'] } },
    });
    expect(codes(r)).toEqual(
      expect.arrayContaining([
        'CERT_CA_NOT_WHITELISTED',
        'CERT_SUBJECT_MISMATCH',
        'IP_PRIVATE',
        'IP_SHARED',
        'ENDPOINT_FOREIGN_DOMAIN',
      ]),
    );
    expect(r.level).toBe('HIGH');
  });

  it('a clean first request is LOW', () => {
    const r = run({ current: {}, previous: null });
    expect(r.level).toBe('LOW');
    expect(r.firstRequest).toBe(true);
  });
});

describe('certificate purpose rules (migration 040)', () => {
  const both = { id: 'old', days: 300 };

  it('a snapshot without the flags (older request) raises nothing', () => {
    const r = run({ current: { certs: [both] }, previous: { certs: [both] } });
    expect(codes(r)).toEqual(['NOTHING_CHANGED']);
  });

  it('a published certificate that becomes login-only is CERT_LOGIN_ONLY', () => {
    const r = run({
      current: { certs: [{ ...both, publish: false, login: true }] },
      previous: { certs: [both] },
    });
    expect(codes(r)).toEqual(['CERT_LOGIN_ONLY']);
    expect(r.findings[0]).toMatchObject({ severity: 'medium', weight: 2 });
    expect(r.level).toBe('MEDIUM');
  });

  it('a new login-only certificate is CERT_LOGIN_ONLY', () => {
    const r = run({
      current: { certs: [both, { id: 'extra', days: 300, publish: false, login: true }] },
      previous: { certs: [both] },
    });
    expect(codes(r)).toContain('CERT_LOGIN_ONLY');
  });

  it('an unchanged login-only certificate raises nothing', () => {
    const lo = { ...both, publish: false, login: true };
    const r = run({
      current: { certs: [lo, { id: 'p', days: 300 }] },
      previous: { certs: [lo, { id: 'p', days: 300 }] },
    });
    expect(codes(r)).toEqual(['NOTHING_CHANGED']);
  });

  it('a published certificate that is unpublished without login is CERT_UNPUBLISHED', () => {
    const r = run({
      current: { certs: [{ ...both, publish: false, login: false }] },
      previous: { certs: [both] },
    });
    expect(codes(r)).toEqual(['CERT_UNPUBLISHED']);
    expect(r.findings[0]).toMatchObject({ severity: 'low', weight: 1 });
  });
});
