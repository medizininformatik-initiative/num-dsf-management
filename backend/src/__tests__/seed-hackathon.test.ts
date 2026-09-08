/**
 * seed-hackathon.test.ts — pure unit tests for the hackathon seed manifest
 * schema and its row-building helpers. No DB: neither manifestSchema.ts nor
 * buildSiteRows.ts perform any database I/O — buildCertificateRow only calls
 * certificate.service's parseCertificate, a synchronous PEM parser, and
 * seed-hackathon.ts's own DB-transaction code is intentionally not imported
 * here.
 *
 * The test certificate is generated in-process with node-forge (same
 * approach as certificate-parse.test.ts / certFingerprint.test.ts) so this
 * file needs no binary fixture.
 */
import forge from 'node-forge';
import {
  hackathonUserSchema,
  hackathonManifestSchema,
  type HackathonUser,
} from '../db/hackathon/manifestSchema';
import { buildSiteRows, buildCertificateRow } from '../db/hackathon/buildSiteRows';
import { assertSeedAllowed } from '../db/seed-hackathon';

function makeSelfSignedCert(cn: string): string {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 1024 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date('2020-01-01T00:00:00Z');
  cert.validity.notAfter = new Date('2030-01-01T00:00:00Z');
  const attrs = [{ shortName: 'CN', value: cn }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey);
  return forge.pki.certificateToPem(cert);
}

const TEST_CERT_PEM = makeSelfSignedCert('hack1.klinik-eins.example.de');
const FP_512 = 'a'.repeat(128);
const TP_256 = 'b'.repeat(64);

function validUserInput(overrides: Record<string, unknown> = {}): unknown {
  return {
    email: 'hack1@klinik-eins.example.de',
    name: 'Hackathon User 1',
    orgIdentifier: 'klinik-eins.example.de',
    orgName: 'Klinikum Eins (Hackathon)',
    city: 'Musterstadt',
    countryCode: 'DE',
    fingerprintSha512: FP_512,
    thumbprintSha256: TP_256,
    certPem: TEST_CERT_PEM,
    admin: true,
    ...overrides,
  };
}

function validUser(overrides: Record<string, unknown> = {}): HackathonUser {
  return hackathonUserSchema.parse(validUserInput(overrides));
}

describe('hackathonUserSchema — valid input', () => {
  it('accepts a fully valid user and normalizes case', () => {
    const result = hackathonUserSchema.safeParse(
      validUserInput({ email: 'HACK1@Klinik-Eins.Example.De', countryCode: 'de' }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe('hack1@klinik-eins.example.de');
      expect(result.data.countryCode).toBe('DE');
    }
  });

  it('normalizes a fingerprint/thumbprint with colons and upper-case hex', () => {
    const colonUpperFp = Array(64).fill('AB').join(':');
    const colonUpperTp = Array(32).fill('CD').join(':');
    const result = hackathonUserSchema.safeParse(
      validUserInput({ fingerprintSha512: colonUpperFp, thumbprintSha256: colonUpperTp }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.fingerprintSha512).toBe('ab'.repeat(64));
      expect(result.data.thumbprintSha256).toBe('cd'.repeat(32));
    }
  });
});

describe('hackathonUserSchema — per-field rejections', () => {
  it('rejects a 127-char (one-short) SHA-512 fingerprint', () => {
    const result = hackathonUserSchema.safeParse(
      validUserInput({ fingerprintSha512: 'a'.repeat(127) }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects a 63-char (one-short) SHA-256 thumbprint', () => {
    const result = hackathonUserSchema.safeParse(
      validUserInput({ thumbprintSha256: 'b'.repeat(63) }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects an email whose domain is not *.example.de', () => {
    const result = hackathonUserSchema.safeParse(
      validUserInput({ email: 'hack1@real-hospital.de' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects an orgIdentifier that is not *.example.de', () => {
    const result = hackathonUserSchema.safeParse(
      validUserInput({ orgIdentifier: 'real-hospital.de' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects a non-FQDN orgIdentifier', () => {
    const result = hackathonUserSchema.safeParse(validUserInput({ orgIdentifier: 'not_a_domain' }));
    expect(result.success).toBe(false);
  });

  it('rejects a missing certPem', () => {
    const input = validUserInput();
    delete (input as Record<string, unknown>).certPem;
    const result = hackathonUserSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects an empty certPem', () => {
    const result = hackathonUserSchema.safeParse(validUserInput({ certPem: '' }));
    expect(result.success).toBe(false);
  });

  it('rejects a certPem carrying a private key', () => {
    // Marker split across concatenation so this fake fixture is not flagged
    // by the repo's private-key secret-scan rule (same trick used in
    // certificate-parse.test.ts / onboarding.service.test.ts).
    const pemLike = '-----BEGIN' + ' PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----';
    const result = hackathonUserSchema.safeParse(validUserInput({ certPem: pemLike }));
    expect(result.success).toBe(false);
  });

  it('rejects a countryCode that is not exactly 2 letters', () => {
    const result = hackathonUserSchema.safeParse(validUserInput({ countryCode: 'DEU' }));
    expect(result.success).toBe(false);
  });
});

describe('hackathonManifestSchema', () => {
  it('accepts a valid manifest with one user', () => {
    const result = hackathonManifestSchema.safeParse({
      parentOrganization: 'hackathon-hub.example.de',
      users: [validUserInput()],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a parentOrganization outside *.example.de', () => {
    const result = hackathonManifestSchema.safeParse({
      parentOrganization: 'real-hub.de',
      users: [validUserInput()],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty users array', () => {
    const result = hackathonManifestSchema.safeParse({
      parentOrganization: 'hackathon-hub.example.de',
      users: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects two users sharing the same orgIdentifier', () => {
    const result = hackathonManifestSchema.safeParse({
      parentOrganization: 'hackathon-hub.example.de',
      users: [
        validUserInput(),
        validUserInput({
          email: 'hack2@klinik-eins.example.de',
          fingerprintSha512: 'c'.repeat(128),
          thumbprintSha256: 'd'.repeat(64),
        }),
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects two users sharing the same email', () => {
    const result = hackathonManifestSchema.safeParse({
      parentOrganization: 'hackathon-hub.example.de',
      users: [
        validUserInput(),
        validUserInput({
          orgIdentifier: 'klinik-zwei.example.de',
          fingerprintSha512: 'c'.repeat(128),
          thumbprintSha256: 'd'.repeat(64),
        }),
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects two users sharing the same fingerprint', () => {
    const result = hackathonManifestSchema.safeParse({
      parentOrganization: 'hackathon-hub.example.de',
      users: [
        validUserInput(),
        validUserInput({
          email: 'hack2@klinik-zwei.example.de',
          orgIdentifier: 'klinik-zwei.example.de',
          thumbprintSha256: 'd'.repeat(64),
        }),
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe('buildSiteRows', () => {
  const parentOrganization = 'hackathon-hub.example.de';

  it('builds an organization row matching the user and marked active', () => {
    const user = validUser();
    const { organization } = buildSiteRows(user, parentOrganization);
    expect(organization).toMatchObject({
      identifier: 'klinik-eins.example.de',
      name: 'Klinikum Eins (Hackathon)',
      active: true,
      email: 'hack1@klinik-eins.example.de',
      city: 'Musterstadt',
      country_code: 'DE',
      client_cert_fingerprint: FP_512,
      client_cert_thumbprint: TP_256,
    });
  });

  it('builds 2 contacts scoped to the organization with distinct types and emails', () => {
    const user = validUser();
    const { contacts, organization } = buildSiteRows(user, parentOrganization);
    expect(contacts).toHaveLength(2);
    for (const c of contacts) expect(c.organization_id).toBe(organization.identifier);
    const types = contacts.map((c) => JSON.parse(c.types));
    expect(types).toEqual(expect.arrayContaining([['DSF_ADMIN'], ['MEDIC']]));
    const emails = contacts.map((c) => c.email);
    expect(new Set(emails).size).toBe(2);
  });

  it('builds a FHIR and a BPE endpoint with distinct identifiers and /fhir addresses', () => {
    const user = validUser();
    const { endpoints, organization } = buildSiteRows(user, parentOrganization);
    expect(endpoints).toHaveLength(2);
    for (const ep of endpoints) {
      expect(ep.organization_id).toBe(organization.identifier);
      expect(ep.address).toMatch(/^https:\/\/.+\/fhir$/);
    }
    expect(endpoints[0].identifier).not.toBe(endpoints[1].identifier);
  });

  it('builds endpoint_ips in RFC 5737 ranges with is_fhir/is_bpe flags matching their endpoint', () => {
    const user = validUser();
    const { endpoints, endpointIps } = buildSiteRows(user, parentOrganization);
    expect(endpointIps).toHaveLength(2);
    const rfc5737 = /^(192\.0\.2|198\.51\.100|203\.0\.113)\.\d{1,3}$/;
    for (const ip of endpointIps) expect(ip.ip).toMatch(rfc5737);

    const fhirIp = endpointIps.find((ip) => ip.endpoint_id === endpoints[0].identifier);
    const bpeIp = endpointIps.find((ip) => ip.endpoint_id === endpoints[1].identifier);
    expect(fhirIp).toMatchObject({ is_fhir: true, is_bpe: false });
    expect(bpeIp).toMatchObject({ is_fhir: false, is_bpe: true });
  });

  it('builds 2 memberships against parentOrganization and the FHIR endpoint, with DIC/HRP roles', () => {
    const user = validUser();
    const { memberships, endpoints, organization } = buildSiteRows(user, parentOrganization);
    expect(memberships).toHaveLength(2);
    for (const m of memberships) {
      expect(m.organization_id).toBe(organization.identifier);
      expect(m.parent_organization).toBe(parentOrganization);
      expect(m.endpoint_id).toBe(endpoints[0].identifier); // the FHIR endpoint
    }
    const roles = memberships.map((m) => JSON.parse(m.roles));
    expect(roles).toEqual(expect.arrayContaining([['DIC'], ['HRP']]));
  });

  it('is deterministic on every field except the random ids', () => {
    const user = validUser();
    const fixedNow = new Date('2026-09-08T12:00:00Z');
    const a = buildSiteRows(user, parentOrganization, fixedNow);
    const b = buildSiteRows(user, parentOrganization, fixedNow);
    expect(a.organization).toEqual(b.organization);
    expect(a.endpointIps.map((ip) => ip.ip)).toEqual(b.endpointIps.map((ip) => ip.ip));
    expect(a.contacts[0].id).not.toBe(b.contacts[0].id); // ids are still fresh uuids
  });

  it('produces a different site for a different orgIdentifier', () => {
    const userA = validUser();
    const userB = validUser({
      email: 'hack2@klinik-zwei.example.de',
      orgIdentifier: 'klinik-zwei.example.de',
    });
    const a = buildSiteRows(userA, parentOrganization);
    const b = buildSiteRows(userB, parentOrganization);
    expect(a.organization.identifier).not.toBe(b.organization.identifier);
    expect(a.endpoints[0].identifier).not.toBe(b.endpoints[0].identifier);
  });
});

describe('buildCertificateRow', () => {
  it('parses a real certificate into an insert-ready row', () => {
    const row = buildCertificateRow('klinik-eins.example.de', TEST_CERT_PEM);
    expect(row.organization_id).toBe('klinik-eins.example.de');
    expect(row.subject).toBe('hack1.klinik-eins.example.de');
    expect(row.thumbprint).toMatch(/^[0-9A-F]{64}$/);
    expect(row.valid_until.getTime()).toBe(new Date('2030-01-01T00:00:00Z').getTime());
    expect(row.pem).toBe(TEST_CERT_PEM.trim()); // buildCertificateRow trims, matching certificate.service.ts
  });

  it('rejects a PEM carrying a private key', () => {
    const pemLike = '-----BEGIN' + ' PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----';
    expect(() => buildCertificateRow('klinik-eins.example.de', pemLike)).toThrow(
      'PRIVATE_KEY_REJECTED',
    );
  });

  it('throws INVALID_PEM for a malformed certificate body', () => {
    const pem = '-----BEGIN CERTIFICATE-----\nnot base64 der at all\n-----END CERTIFICATE-----';
    expect(() => buildCertificateRow('klinik-eins.example.de', pem)).toThrow('INVALID_PEM');
  });
});

describe('assertSeedAllowed', () => {
  let exitSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('refuses a PRODUCTION environment without the override', () => {
    assertSeedAllowed({ DSF_ENVIRONMENT: 'PRODUCTION' });

    expect(errorSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('allows a PRODUCTION environment when HACKATHON_ALLOW_PRODUCTION=1', () => {
    assertSeedAllowed({ DSF_ENVIRONMENT: 'PRODUCTION', HACKATHON_ALLOW_PRODUCTION: '1' });

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('allows a TEST environment without the override', () => {
    assertSeedAllowed({ DSF_ENVIRONMENT: 'TEST' });

    expect(exitSpy).not.toHaveBeenCalled();
  });
});
