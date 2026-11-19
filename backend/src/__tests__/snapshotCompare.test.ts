import { snapshotsDiffer } from '../lib/snapshotCompare';

const base = () => ({
  organization: {
    identifier: 'a.de',
    name: 'A',
    active: 1,
    updated_at: '2026-01-01T00:00:00.000Z',
  },
  contacts: [
    { id: '1', phone: '123', city: 'X' },
    { id: '2', phone: '456', city: 'Y' },
  ],
  endpoints: [{ identifier: 'e', ipAddresses: [{ ip: '1.1.1.1' }, { ip: '2.2.2.2' }] }],
  certificates: [{ id: 'c', thumbprint: 'AA' }],
  snapshotAt: '2026-01-01T00:00:00.000Z',
});

describe('snapshotsDiffer', () => {
  it('identical snapshots are equal', () => {
    expect(snapshotsDiffer(base(), base())).toBe(false);
  });
  it('reordered arrays and keys are equal', () => {
    const b = base();
    b.contacts.reverse();
    b.endpoints[0].ipAddresses.reverse();
    expect(snapshotsDiffer(base(), b)).toBe(false);
  });
  it('only timestamps differ is equal', () => {
    const b = base();
    b.snapshotAt = '2027-01-01T00:00:00.000Z';
    b.organization.updated_at = '2027-01-01T00:00:00.000Z';
    expect(snapshotsDiffer(base(), b)).toBe(false);
  });
  it('Date values are normalized to ISO strings', () => {
    const a = { x: { valid_until: new Date('2030-01-01T00:00:00Z') } };
    const b = { x: { valid_until: '2030-01-01T00:00:00.000Z' } };
    expect(snapshotsDiffer(a, b)).toBe(false);
  });
  it('changed IP is different', () => {
    const b = base();
    b.endpoints[0].ipAddresses[0].ip = '9.9.9.9';
    expect(snapshotsDiffer(base(), b)).toBe(true);
  });
  it('changed phone is different', () => {
    const b = base();
    b.contacts[0].phone = '999';
    expect(snapshotsDiffer(base(), b)).toBe(true);
  });
  it('changed thumbprint is different', () => {
    const b = base();
    b.certificates[0].thumbprint = 'BB';
    expect(snapshotsDiffer(base(), b)).toBe(true);
  });
  it('ignores system- and admin-managed fields', () => {
    const a = {
      contacts: [{ id: '1', email_validated: 0 }],
      organization: { client_cert_thumbprint: 'x' },
    };
    const b = {
      contacts: [{ id: '1', email_validated: 1 }],
      organization: { client_cert_thumbprint: 'y' },
    };
    expect(snapshotsDiffer(a, b)).toBe(false);
  });
  it('compares the editable digest only when both snapshots carry it', () => {
    expect(snapshotsDiffer({ ...base(), editableDigest: 'a' }, base())).toBe(false);
    expect(
      snapshotsDiffer({ ...base(), editableDigest: 'a' }, { ...base(), editableDigest: 'b' }),
    ).toBe(true);
  });
  it('accepts a JSON string on either side', () => {
    expect(snapshotsDiffer(base(), JSON.stringify(base()))).toBe(false);
    expect(snapshotsDiffer(JSON.stringify(base()), base())).toBe(false);
  });
  it('returns null for unreadable input', () => {
    expect(snapshotsDiffer(base(), '{not json')).toBeNull();
    expect(snapshotsDiffer(base(), null)).toBeNull();
    expect(snapshotsDiffer(undefined, base())).toBeNull();
  });
  it('ignores facts derived from a certificate PEM', () => {
    const withFacts = {
      certificates: [
        { thumbprint: 'T', issuerDn: 'CN=CA', subjectDn: 'CN=a', sanDns: ['a'], notAfter: 'x' },
      ],
    };
    expect(snapshotsDiffer(withFacts, { certificates: [{ thumbprint: 'T' }] })).toBe(false);
    expect(snapshotsDiffer(withFacts, { certificates: [{ thumbprint: 'U' }] })).toBe(true);
  });
});
