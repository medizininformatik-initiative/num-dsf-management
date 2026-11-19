/**
 * requestRisk.test.ts – Level thresholds and the certificate rules of the pure request-risk assessment.
 * Dependencies: lib/requestRisk, helpers/requestRiskFixtures
 */
import { assessRequest, type RiskInput } from '../lib/requestRisk';
import { codes, ctx, GEANT, R11, ORG, run, snap, type Case } from './helpers/requestRiskFixtures';

describe('level thresholds', () => {
  it('an unchanged resubmission is LOW with NOTHING_CHANGED', () => {
    const r = run({ current: {}, previous: {} });
    expect(r.level).toBe('LOW');
    expect(codes(r)).toContain('NOTHING_CHANGED');
    expect(r.firstRequest).toBe(false);
  });

  it('a lone medium finding is MEDIUM', () => {
    const r = run({ current: { name: 'Renamed' }, previous: {} });
    expect(codes(r)).toEqual(['ORG_NAME_CHANGED']);
    expect(r.level).toBe('MEDIUM');
  });

  it('three low findings reach MEDIUM through the score', () => {
    const r = run({
      current: {
        endpoints: [
          { id: `dsf.${ORG}`, ips: ['93.184.216.34'] },
          { id: `dsf2.${ORG}`, ips: ['93.184.216.35'] },
        ],
        memberships: [{ parent: 'num.de', roles: ['DIC', 'HRP'] }],
        active: false,
      },
      previous: {},
    });
    expect(r.findings.every((f) => f.severity === 'low')).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(3);
    expect(r.level).toBe('MEDIUM');
  });

  it('two low findings stay LOW', () => {
    const r = run({
      current: { memberships: [{ parent: 'num.de', roles: ['DIC', 'HRP'] }], active: false },
      previous: {},
    });
    expect(r.score).toBe(2);
    expect(r.level).toBe('LOW');
  });

  it('any high finding is HIGH', () => {
    const r = run({
      current: {},
      previous: {},
      caStatus: { [GEANT]: 'unknown' },
      extraInfo: [],
    });
    // The unchanged certificate is not new, so force a new one with an unknown CA.
    expect(r.level).toBe('LOW');
    const r2 = run({
      current: { certs: [{ id: 'new', days: 300, issuer: R11 }] },
      previous: {},
      caStatus: { [GEANT]: 'whitelisted', [R11]: 'unknown' },
    });
    expect(codes(r2)).toContain('CERT_CA_NOT_WHITELISTED');
    expect(r2.level).toBe('HIGH');
  });

  it('sorts findings by severity, highest first', () => {
    const r = run({
      current: { name: 'Other', certs: [{ id: 'new', days: 300, issuer: R11 }] },
      previous: {},
      caStatus: { [R11]: 'unknown', [GEANT]: 'whitelisted' },
    });
    const order = { high: 3, medium: 2, low: 1, info: 0 } as const;
    const sev = r.findings.map((f) => order[f.severity]);
    expect([...sev].sort((a, b) => b - a)).toEqual(sev);
  });
});

describe('certificate rules', () => {
  const renewal: Case = {
    current: { certs: [{ id: 'new', days: 365 }] },
    previous: { certs: [{ id: 'old', days: 12 }] },
  };

  it('a pure renewal of an expiring certificate is LOW', () => {
    const r = run(renewal);
    expect(codes(r)).toEqual(['CERT_RENEWAL']);
    expect(r.score).toBe(-1);
    expect(r.level).toBe('LOW');
    expect(r.findings[0].params).toEqual({ cn: `dsf.${ORG}`, days: 12 });
  });

  it('renewal of an already expired certificate carries negative days', () => {
    const r = run({
      current: { certs: [{ id: 'new', days: 365 }] },
      previous: { certs: [{ id: 'old', days: -3 }] },
    });
    expect(codes(r)).toEqual(['CERT_RENEWAL']);
    expect(r.findings[0].params.days).toBe(-3);
  });

  it('replacing a certificate that is still valid for long is CERT_EARLY_REPLACE', () => {
    const r = run({
      current: { certs: [{ id: 'new', days: 365 }] },
      previous: { certs: [{ id: 'old', days: 70 }] },
    });
    expect(codes(r)).toEqual(['CERT_EARLY_REPLACE']);
    expect(r.level).toBe('MEDIUM');
    expect(r.findings[0].params.days).toBe(70);
  });

  it('a replacement from another CA is CERT_ISSUER_CHANGED with both CA names', () => {
    const r = run({
      current: { certs: [{ id: 'new', days: 365, issuer: R11 }] },
      previous: { certs: [{ id: 'old', days: 20 }] },
    });
    expect(codes(r)).toEqual(['CERT_ISSUER_CHANGED']);
    expect(r.findings[0].params).toEqual({ from: 'GEANT TLS ECC 1', to: 'R11' });
  });

  it('flags a CA that is not on the whitelist and one on the blacklist', () => {
    const base = {
      current: { certs: [{ id: 'new', days: 365, issuer: R11 }] },
      previous: { certs: [{ id: 'old', days: 20, issuer: R11 }] },
    };
    const unknown = run({ ...base, caStatus: { [R11]: 'unknown' } });
    expect(codes(unknown)).toContain('CERT_CA_NOT_WHITELISTED');
    const black = run({ ...base, caStatus: { [R11]: 'blacklisted' } });
    expect(codes(black)).toContain('CERT_CA_BLACKLISTED');
    expect(codes(black)).not.toContain('CERT_CA_NOT_WHITELISTED');
    expect(black.score).toBeGreaterThanOrEqual(5);
  });

  it('flags a certificate whose names do not match the organization or endpoints', () => {
    const r = run({
      current: { certs: [{ id: 'new', days: 365, cn: 'dsf.evil.org' }] },
      previous: { certs: [{ id: 'old', days: 20 }] },
    });
    expect(codes(r)).toContain('CERT_SUBJECT_MISMATCH');
  });

  it('accepts a SAN that matches the organization domain', () => {
    const r = run({
      current: { certs: [{ id: 'new', days: 365, cn: 'other.org', sans: ['x.org', 'a.ukm.de'] }] },
      previous: { certs: [{ id: 'old', days: 20, cn: 'other.org', sans: ['x.org', 'a.ukm.de'] }] },
    });
    expect(codes(r)).not.toContain('CERT_SUBJECT_MISMATCH');
  });

  it('accepts a certificate for the registrable domain of an endpoint host', () => {
    const r = run({
      current: {
        endpoints: [{ id: 'dsf.hospital.org', address: 'https://dsf.hospital.org/fhir' }],
        certs: [{ id: 'new', days: 365, cn: 'dsf.hospital.org' }],
      },
      previous: {
        endpoints: [{ id: 'dsf.hospital.org', address: 'https://dsf.hospital.org/fhir' }],
        certs: [{ id: 'old', days: 20, cn: 'dsf.hospital.org' }],
      },
    });
    expect(codes(r)).not.toContain('CERT_SUBJECT_MISMATCH');
  });

  it('an added certificate without replacement is CERT_ADDED', () => {
    const r = run({
      current: {
        certs: [
          { id: 'old', days: 300 },
          { id: 'extra', days: 300 },
        ],
      },
      previous: {},
    });
    expect(codes(r)).toEqual(['CERT_ADDED']);
    expect(r.level).toBe('LOW');
  });

  it('replacing every one of several certificates is CERT_ALL_REPLACED', () => {
    const r = run({
      current: {
        certs: [
          { id: 'n1', days: 300 },
          { id: 'n2', days: 300 },
        ],
      },
      previous: {
        certs: [
          { id: 'o1', days: 10 },
          { id: 'o2', days: 10 },
        ],
      },
    });
    expect(codes(r)).toContain('CERT_ALL_REPLACED');
  });

  it('notes a new certificate that expires within 30 days without raising the score', () => {
    const r = run({
      current: { certs: [{ id: 'new', days: 20 }] },
      previous: { certs: [{ id: 'old', days: 10 }] },
    });
    const short = r.findings.find((f) => f.code === 'CERT_SHORT_VALIDITY');
    expect(short).toMatchObject({ severity: 'info', weight: 0 });
  });

  it('skips issuer checks when the certificate row is gone', () => {
    const input: RiskInput = {
      current: snap({ certs: [{ id: 'new', days: 365 }] }),
      previous: snap({ certs: [{ id: 'old', days: 12 }] }),
      certInfo: {},
      caStatus: {},
      context: ctx(),
    };
    const r = assessRequest(input);
    expect(r.findings.map((f) => f.code)).toEqual(['CERT_RENEWAL']);
    expect(r.level).toBe('LOW');
  });
});
