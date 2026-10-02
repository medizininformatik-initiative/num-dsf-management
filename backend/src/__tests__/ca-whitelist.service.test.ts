/**
 * ca-whitelist.service.test.ts – The CA whitelist seeded at init (migration
 * 022, DSF 2.1.1 defaults): issuer matching, manual entries, the
 * blacklist conflict guard and the enforcement switch.
 * Dependencies: db/connection, ca-whitelist.service, ca-blacklist.service
 */
import { db } from '../db/connection';
import {
  addToWhitelist,
  isIssuerWhitelisted,
  isWhitelistEnforced,
  listWhitelist,
  removeFromWhitelist,
  whitelistedIssuers,
} from '../services/ca-whitelist.service';
import { addToBlacklist } from '../services/ca-blacklist.service';

const GEANT_TLS_RSA = 'C=GR,O=Hellenic Academic and Research Institutions CA,CN=GEANT TLS RSA 1';
const DFN_GLOBAL =
  'C=DE,O=Verein zur Foerderung eines Deutschen Forschungsnetzes e. V.,OU=DFN-PKI,CN=DFN-Verein Global Issuing CA';
const DTRUST_BR_ROOT_2 = 'C=DE,O=D-Trust GmbH,CN=D-TRUST BR Root CA 2 2023';
const ADMIN = `caw-admin-${Date.now()}@example.de`;

describe('ca-whitelist service', () => {
  afterEach(async () => {
    await db('ca_whitelist').where({ added_by: ADMIN }).del();
    await db('ca_blacklist').where({ added_by: ADMIN }).del();
  });

  it('is seeded at init with the 38 DSF client CAs and 7 server roots', async () => {
    const dsf = (await listWhitelist()).filter((r) => r.source === 'dsf-2.1.1');
    expect(dsf.filter((r) => r.kind === 'CLIENT')).toHaveLength(38);
    expect(dsf.filter((r) => r.kind === 'SERVER')).toHaveLength(7);
    expect(dsf.every((r) => /^[0-9A-F]{64}$/.test(r.fingerprint ?? ''))).toBe(true);
    expect(dsf.map((r) => r.subject_dn)).toEqual(
      expect.arrayContaining([GEANT_TLS_RSA, DFN_GLOBAL, DTRUST_BR_ROOT_2]),
    );
  });

  it('matches an issuer DN regardless of RDN order, spacing and case', async () => {
    expect(await isIssuerWhitelisted(GEANT_TLS_RSA)).toBe(true);
    expect(
      await isIssuerWhitelisted(
        'cn=GEANT TLS RSA 1, o=Hellenic Academic and Research Institutions CA, c=GR',
      ),
    ).toBe(true);
  });

  it('does not trust self-signed issuers or server-only roots as certificate issuers', async () => {
    expect(await isIssuerWhitelisted('CN=dsf-client.klinik.example.de')).toBe(false);
    // Server roots tell a BPE which TLS servers to trust; they issue no DSF client certs.
    expect(await isIssuerWhitelisted(DTRUST_BR_ROOT_2)).toBe(false);
    const trusted = await whitelistedIssuers([DFN_GLOBAL, 'CN=Unknown CA']);
    expect([...trusted]).toEqual([DFN_GLOBAL]);
  });

  it('adds manual entries, refuses duplicates and removes them again', async () => {
    const dn = `C=DE,O=Klinik CA ${Date.now()},CN=Klinik Issuing CA`;
    const id = await addToWhitelist({ subjectDn: dn, kind: 'CLIENT', reason: 'jest' }, ADMIN);
    expect(await isIssuerWhitelisted(dn)).toBe(true);
    await expect(
      addToWhitelist({ subjectDn: dn.toUpperCase(), kind: 'CLIENT' }, ADMIN),
    ).rejects.toThrow('CONFLICT');
    await removeFromWhitelist(id, ADMIN);
    expect(await isIssuerWhitelisted(dn)).toBe(false);
    await expect(removeFromWhitelist(id, ADMIN)).rejects.toThrow('NOT_FOUND');
  });

  it('refuses to blacklist a CA that DSF accepts in production', async () => {
    await expect(addToBlacklist({ subjectDn: GEANT_TLS_RSA }, ADMIN)).rejects.toThrow(
      'CA_WHITELISTED',
    );
  });

  it('enforces the whitelist only with CA_WHITELIST_ENFORCE=true', () => {
    const before = process.env.CA_WHITELIST_ENFORCE;
    try {
      delete process.env.CA_WHITELIST_ENFORCE;
      expect(isWhitelistEnforced()).toBe(false);
      process.env.CA_WHITELIST_ENFORCE = 'true';
      expect(isWhitelistEnforced()).toBe(true);
    } finally {
      if (before === undefined) delete process.env.CA_WHITELIST_ENFORCE;
      else process.env.CA_WHITELIST_ENFORCE = before;
    }
  });
});
