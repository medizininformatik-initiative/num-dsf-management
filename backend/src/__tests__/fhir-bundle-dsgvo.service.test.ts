/**
 * fhir-bundle-dsgvo.service.test.ts — DB-backed contract + DSGVO tests for
 * fhir.service generateBundle / generateFullBundle.
 *
 * generateBundle: seeds ONE complete, approved instance (organization +
 * endpoint + endpoint_ips + certificate + membership + a CONTACT carrying
 * recognizable PII) and a second site as the receiver. The receiver's bundle
 * must embed the peer's Organization and Endpoint with the expected
 * identifiers/address and the certificate thumbprint as an extension, pass
 * the DSF acceptance rules, AND — the load-bearing DSGVO check — never leak
 * the contact's data or the organization e-mail into the serialized bundle.
 *
 * generateFullBundle: seeds an APPROVED instance and a non-approved (DRAFT)
 * instance and asserts the network-wide bundle aggregates only the approved
 * organization, excluding the non-approved one.
 *
 * Corrupted at-rest PEMs are covered on dsfThumbprint directly: an approved
 * organization with a broken PEM would fail every concurrent bundle test.
 *
 * Each test seeds its own fresh rows with unique identifiers so parallel
 * suites never collide; teardown removes only the rows it created.
 *
 * Dependencies: db/connection, fhir.service, helpers/allowListSites,
 *               helpers/dsfAllowListChecks
 */
import { v4 as uuidv4 } from 'uuid';
import forge from 'node-forge';
import { db } from '../db/connection';
import { dsfThumbprint, generateBundle, generateFullBundle } from '../services/fhir.service';
import { sha512FingerprintFromPem } from '../lib/certFingerprint';
import { removeSites, seedSite, type Site } from './helpers/allowListSites';
import { dsfAllowListViolations } from './helpers/dsfAllowListChecks';

// Real self-signed cert PEM, generated in-process like certFingerprint.test.ts,
// so the bundle's extension-certificate-thumbprint (now SHA-512 of the DER)
// can be computed for real instead of asserted against a hand-picked constant.
function makeCertPem(cn: string): string {
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

interface Coding {
  system: string;
  code: string;
}
interface Resource {
  resourceType: string;
  name?: string;
  address?: string;
  active?: boolean;
  identifier?: Array<{ system: string; value: string }>;
  extension?: Array<{ url: string; valueString: string }>;
  endpoint?: Array<{ reference: string }>;
}
// DELETE entries carry no resource; other suites may add them concurrently.
interface Entry {
  fullUrl?: string;
  resource?: Resource;
  request: { method: string; url: string };
}
interface Bundle {
  resourceType: string;
  type: string;
  entry: Entry[];
}

const uniq = (p: string) => `${p}-${Date.now()}-${uuidv4().slice(0, 8)}`;

describe('fhir.service – generateBundle (approved peer seen by a receiver + DSGVO)', () => {
  let receiver: Site;
  const bundleForReceiver = async () =>
    (await generateBundle(receiver.instanceId, receiver.endpointIds[0])) as unknown as Bundle;
  const userId = uuidv4();
  const instanceId = uuidv4();
  const orgId = `${uniq('fhir-org')}.example.de`;
  const parentId = `${uniq('fhir-verbund')}.example.de`;
  const endpointId = `dsf-fhir.${orgId}`;
  const thumbprint = 'b'.repeat(64);
  const certPem = makeCertPem(orgId);
  const certId = uuidv4();
  const membershipId = uuidv4();
  const contactId = uuidv4();
  const ipId = uuidv4();

  // Recognizable, unique PII that MUST NOT appear in the published bundle.
  const contactEmail = `dsgvo-leak-${Date.now()}@example.de`;
  const contactName = `Dr DsgvoLeak ${uuidv4().slice(0, 8)}`;
  const contactPhone = `+4930${String(Date.now()).slice(-7)}`;

  beforeAll(async () => {
    await db('users').insert({
      id: userId,
      email: `${userId}@example.de`,
      totp_enabled: false,
      created_at: new Date(),
    });
    await db('instances').insert({
      id: instanceId,
      user_id: userId,
      label: 'fhir-single',
      created_at: new Date(),
    });
    await db('organizations').insert({
      identifier: orgId,
      instance_id: instanceId,
      name: 'FHIR Single Org',
      active: true,
      email: 'org@example.de',
      address_line: 'Org Street 1',
      postal_code: '48149',
      city: 'Muenster',
      country_code: 'DE',
      created_at: new Date(),
      updated_at: new Date(),
    });
    await db('endpoints').insert({
      identifier: endpointId,
      organization_id: orgId,
      name: 'Primary FHIR Endpoint',
      address: `https://${endpointId}/fhir`,
      created_at: new Date(),
      updated_at: new Date(),
    });
    await db('endpoint_ips').insert({
      id: ipId,
      endpoint_id: endpointId,
      ip: '10.20.30.40',
      is_fhir: true,
      is_bpe: false,
    });
    await db('certificates').insert({
      id: certId,
      organization_id: orgId,
      pem: certPem,
      subject: `CN=${orgId}`,
      thumbprint,
      valid_until: '2099-01-01',
      created_at: new Date(),
    });
    await db('memberships').insert({
      id: membershipId,
      organization_id: orgId,
      parent_organization: parentId,
      endpoint_id: endpointId,
      roles: JSON.stringify(['DIC', 'HRP']),
      created_at: new Date(),
      updated_at: new Date(),
    });
    // The contact lives under the same org but must never reach the bundle.
    await db('contacts').insert({
      id: contactId,
      organization_id: orgId,
      types: JSON.stringify(['DSF_ADMIN']),
      name: contactName,
      email: contactEmail,
      email_validated: true,
      phone: contactPhone,
      address_line: 'Secret Street 9',
      city: 'Muenster',
      postal_code: '48149',
      country_code: 'DE',
      created_at: new Date(),
      updated_at: new Date(),
    });
    // Only an approved organization is published to other sites.
    await db('approval_requests').insert({
      id: uuidv4(),
      instance_id: instanceId,
      status: 'APPROVED',
      created_at: new Date(),
      submitted_at: new Date(),
      resolved_at: new Date(),
      snapshot_json: JSON.stringify({}),
    });
    receiver = await seedSite({ label: 'dsgvo-receiver', approval: null });
  });

  afterAll(async () => {
    await removeSites([receiver]);
    try {
      await db('approval_requests').where({ instance_id: instanceId }).del();
      await db('contacts').where({ organization_id: orgId }).del();
      await db('memberships').where({ organization_id: orgId }).del();
      await db('certificates').where({ organization_id: orgId }).del();
      await db('endpoint_ips').where({ endpoint_id: endpointId }).del();
      await db('endpoints').where({ identifier: endpointId }).del();
    } finally {
      await db('organizations').where({ identifier: orgId }).del();
      await db('instances').where({ id: instanceId }).del();
      await db('users').where({ id: userId }).del();
    }
  });

  it('returns a FHIR transaction Bundle', async () => {
    const bundle = await bundleForReceiver();
    expect(bundle.resourceType).toBe('Bundle');
    expect(bundle.type).toBe('transaction');
    expect(Array.isArray(bundle.entry)).toBe(true);
  });

  it('embeds the Organization with the expected identifier and name', async () => {
    const bundle = await bundleForReceiver();
    const orgEntry = bundle.entry.find(
      (e) =>
        e.resource?.resourceType === 'Organization' &&
        (e.resource?.identifier ?? []).some((i) => i.value === orgId),
    );
    expect(orgEntry).toBeDefined();
    expect(orgEntry!.resource!.name).toBe('FHIR Single Org');
    expect(orgEntry!.resource!.active).toBe(true);
  });

  it('embeds the Endpoint with the expected identifier and FHIR address', async () => {
    const bundle = await bundleForReceiver();
    const epEntry = bundle.entry.find(
      (e) =>
        e.resource?.resourceType === 'Endpoint' &&
        (e.resource?.identifier ?? []).some((i) => i.value === endpointId),
    );
    expect(epEntry).toBeDefined();
    expect(epEntry!.resource!.address).toBe(`https://${endpointId}/fhir`);
    expect(epEntry!.resource!.name).toBe('Primary FHIR Endpoint');
  });

  it('embeds the certificate SHA-512 DSF thumbprint as an Organization extension', async () => {
    const bundle = await bundleForReceiver();
    const orgEntry = bundle.entry.find(
      (e) =>
        e.resource?.resourceType === 'Organization' &&
        (e.resource?.identifier ?? []).some((i) => i.value === orgId),
    );
    const ext = orgEntry!.resource!.extension ?? [];
    const expectedSha512 = sha512FingerprintFromPem(certPem);
    const match = ext.find(
      (x) => x.url === 'http://dsf.dev/fhir/StructureDefinition/extension-certificate-thumbprint',
    );
    expect(match).toBeDefined();
    // Must be the SHA-512 of the DER (128 lower-case hex), never the SHA-256
    // `certificates.thumbprint` column value — that would violate the DSF
    // StructureDefinition's hex-128-length constraint.
    expect(match!.valueString).toBe(expectedSha512);
    expect(match!.valueString).toMatch(/^[a-f0-9]{128}$/);
    expect(match!.valueString).not.toBe(thumbprint);
  });

  it('emits an OrganizationAffiliation referencing the parent verbund', async () => {
    const bundle = await bundleForReceiver();
    const aff = bundle.entry.find(
      (e) =>
        e.resource?.resourceType === 'OrganizationAffiliation' &&
        e.request.url.includes(`|${orgId}&`) &&
        e.request.url.includes(`|${parentId}&`),
    );
    expect(aff).toBeDefined();
    // Parent verbund Organization is emitted so the affiliation reference resolves.
    const parentOrg = bundle.entry.find(
      (e) =>
        e.resource?.resourceType === 'Organization' &&
        (e.resource?.identifier ?? []).some((i) => i.value === parentId),
    );
    expect(parentOrg).toBeDefined();
  });

  it('DSGVO: the serialized bundle never contains the contact email or PII', async () => {
    const bundle = await bundleForReceiver();
    const serialized = JSON.stringify(bundle);
    expect(serialized).not.toContain(contactEmail);
    expect(serialized).not.toContain(contactName);
    expect(serialized).not.toContain(contactPhone);
    expect(serialized).not.toContain('Secret Street 9');
    // Defensive: the contact row's primary key must not leak either.
    expect(serialized).not.toContain(contactId);
    // The organization e-mail is contact data too (F-BND-04): no telecom.
    expect(serialized).not.toContain('org@example.de');
    expect(serialized).not.toContain('"telecom"');
  });

  it('passes the DSF acceptance rules of the allow-list process for the receiver', async () => {
    const bundle = await bundleForReceiver();
    expect(
      dsfAllowListViolations(bundle, {
        receiverOrganization: receiver.orgId,
        receiverEndpoint: receiver.endpointIds[0],
      }),
    ).toEqual([]);
  });
});

describe('fhir.service – generateFullBundle (approved-only aggregation)', () => {
  const userId = uuidv4();
  const approvedInstanceId = uuidv4();
  const draftInstanceId = uuidv4();
  const approvedOrgId = `${uniq('fb-approved')}.example.de`;
  const draftOrgId = `${uniq('fb-draft')}.example.de`;
  const verbundId = `${uniq('fb-verbund')}.example.de`;
  const approvedEpId = `dsf-fhir.${approvedOrgId}`;
  const approvedCertId = uuidv4();
  const approvedCertPem = makeCertPem(approvedOrgId);

  beforeAll(async () => {
    await db('users').insert({
      id: userId,
      email: `${userId}@example.de`,
      totp_enabled: false,
      created_at: new Date(),
    });
    await db('instances').insert([
      { id: approvedInstanceId, user_id: userId, label: 'fb-approved', created_at: new Date() },
      { id: draftInstanceId, user_id: userId, label: 'fb-draft', created_at: new Date() },
    ]);
    await db('organizations').insert([
      {
        identifier: approvedOrgId,
        instance_id: approvedInstanceId,
        name: 'FB Approved',
        active: true,
        email: 'a@example.de',
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        identifier: draftOrgId,
        instance_id: draftInstanceId,
        name: 'FB Draft',
        active: true,
        email: 'd@example.de',
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);
    await db('endpoints').insert({
      identifier: approvedEpId,
      organization_id: approvedOrgId,
      name: 'FB Approved EP',
      address: `https://${approvedEpId}/fhir`,
      created_at: new Date(),
      updated_at: new Date(),
    });
    await db('certificates').insert({
      id: approvedCertId,
      organization_id: approvedOrgId,
      pem: approvedCertPem,
      subject: `CN=${approvedOrgId}`,
      thumbprint: 'c'.repeat(64),
      valid_until: '2099-01-01',
      created_at: new Date(),
    });
    await db('memberships').insert({
      id: uuidv4(),
      organization_id: approvedOrgId,
      parent_organization: verbundId,
      endpoint_id: approvedEpId,
      roles: JSON.stringify(['DIC']),
      created_at: new Date(),
      updated_at: new Date(),
    });
    // Only the approved instance gets an APPROVED approval_request.
    await db('approval_requests').insert({
      id: uuidv4(),
      instance_id: approvedInstanceId,
      status: 'APPROVED',
      created_at: new Date(),
      submitted_at: new Date(),
      resolved_at: new Date(),
      resolved_by: 'admin@example.de',
      snapshot_json: JSON.stringify({}),
    });
    // The draft instance has a non-approved request → its org must be excluded.
    await db('approval_requests').insert({
      id: uuidv4(),
      instance_id: draftInstanceId,
      status: 'DRAFT',
      created_at: new Date(),
      snapshot_json: JSON.stringify({}),
    });
  });

  afterAll(async () => {
    try {
      await db('memberships').where({ organization_id: approvedOrgId }).del();
      await db('certificates').where({ organization_id: approvedOrgId }).del();
      await db('endpoints').where({ identifier: approvedEpId }).del();
      await db('approval_requests')
        .whereIn('instance_id', [approvedInstanceId, draftInstanceId])
        .del();
    } finally {
      await db('organizations').whereIn('identifier', [approvedOrgId, draftOrgId]).del();
      await db('instances').whereIn('id', [approvedInstanceId, draftInstanceId]).del();
      await db('users').where({ id: userId }).del();
    }
  });

  it('aggregates the APPROVED org but excludes the non-approved org', async () => {
    const bundle = (await generateFullBundle()) as unknown as Bundle;
    const orgIds = bundle.entry.flatMap((e) =>
      e.resource?.resourceType === 'Organization'
        ? (e.resource?.identifier ?? []).map((i) => i.value)
        : [],
    );
    expect(orgIds).toContain(approvedOrgId);
    expect(orgIds).not.toContain(draftOrgId);
  });

  it('emits the parent verbund Organization for the approved org', async () => {
    const bundle = (await generateFullBundle()) as unknown as Bundle;
    const orgIds = bundle.entry.flatMap((e) =>
      e.resource?.resourceType === 'Organization'
        ? (e.resource?.identifier ?? []).map((i) => i.value)
        : [],
    );
    expect(orgIds).toContain(verbundId);
  });

  it('includes the approved org endpoint with the expected address', async () => {
    const bundle = (await generateFullBundle()) as unknown as Bundle;
    const epEntry = bundle.entry.find(
      (e) =>
        e.resource?.resourceType === 'Endpoint' &&
        (e.resource?.identifier ?? []).some((i) => i.value === approvedEpId),
    );
    expect(epEntry).toBeDefined();
    expect(epEntry!.resource!.address).toBe(`https://${approvedEpId}/fhir`);
  });

  it('every certificate-thumbprint extension in the full bundle is a 128-hex SHA-512 value', async () => {
    const bundle = (await generateFullBundle()) as unknown as Bundle;
    const thumbprintExtensions = bundle.entry.flatMap((e) =>
      e.resource?.resourceType === 'Organization'
        ? (e.resource?.extension ?? []).filter(
            (x) =>
              x.url === 'http://dsf.dev/fhir/StructureDefinition/extension-certificate-thumbprint',
          )
        : [],
    );
    expect(thumbprintExtensions.length).toBeGreaterThan(0);
    for (const ext of thumbprintExtensions) {
      expect(ext.valueString).toMatch(/^[a-f0-9]{128}$/);
    }
    // The approved org's own extension must be the real SHA-512 of its stored PEM.
    expect(thumbprintExtensions.map((x) => x.valueString)).toContain(
      sha512FingerprintFromPem(approvedCertPem),
    );
  });
});

describe('fhir.service – dsfThumbprint (corrupted certificate PEM)', () => {
  it('rejects with CERTIFICATE_PEM_INVALID naming the certificate id, instead of dropping it silently', () => {
    // Corrupted at-rest data: not a parseable PEM. The bundle must fail loudly,
    // naming the certificate, rather than publish an organization without it.
    const certId = uuidv4();
    expect(() => dsfThumbprint({ id: certId, pem: 'CERT-MARKER' })).toThrow(
      `CERTIFICATE_PEM_INVALID:${certId}`,
    );
  });

  it('returns the 128-hex SHA-512 of a valid PEM', () => {
    const pem = makeCertPem('dsf-client.thumbprint.example.de');
    expect(dsfThumbprint({ id: uuidv4(), pem })).toBe(sha512FingerprintFromPem(pem));
  });
});
