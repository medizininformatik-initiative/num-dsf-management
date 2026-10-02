/**
 * fullBundle.test.ts — Network-wide allow-list bundle contract.
 * - Only APPROVED + active orgs are included
 * - Cert thumbprints appear as extensions
 * - Parent verbund Organizations are present
 * - All references in the bundle resolve to a fullUrl in the same bundle
 * - Soft-deleted memberships and organizations whose deactivation was
 *   approved are published as DELETE entries
 *
 * Dependencies: generateFullBundle (fhir.service), db/connection (Knex),
 *               helpers/allowListSites
 */
import forge from 'node-forge';
import { generateFullBundle } from '../../services/fhir.service';
import { db } from '../../db/connection';
import { sha512FingerprintFromPem } from '../../lib/certFingerprint';
import { v4 as uuidv4 } from 'uuid';
import { removeSites, seedSite } from '../helpers/allowListSites';

// Real self-signed cert PEM (in-process, like certFingerprint.test.ts) so the
// bundle's extension-certificate-thumbprint (SHA-512 of the DER) is a genuine
// computed value rather than a hand-picked constant.
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

interface Resource {
  resourceType: string;
  identifier?: Array<{ system: string; value: string }>;
  extension?: Array<{ url: string; valueString: string }>;
  endpoint?: Array<{ reference: string }>;
  managingOrganization?: { reference: string };
  organization?: { reference: string };
  participatingOrganization?: { reference: string };
}
// DELETE entries carry neither fullUrl nor resource.
interface Entry {
  fullUrl?: string;
  resource?: Resource;
  request?: { method: string; url: string };
}

describe('generateFullBundle', () => {
  const userId = uuidv4();
  const approvedInstanceId = uuidv4();
  const draftInstanceId = uuidv4();
  const approvedOrgId = 'fb-approved.example.de';
  const draftOrgId = 'fb-draft.example.de';
  const verbundId = 'fb-verbund.example.de';
  const epId = `dsf-fhir.${approvedOrgId}`;
  const certPem = makeCertPem(approvedOrgId);

  beforeAll(async () => {
    await db('users')
      .insert({ id: userId, email: 'fb@example.de', created_at: new Date() })
      .onConflict('email')
      .ignore();
    await db('instances').insert([
      { id: approvedInstanceId, user_id: userId, label: 'A', created_at: new Date() },
      { id: draftInstanceId, user_id: userId, label: 'B', created_at: new Date() },
    ]);
    await db('organizations').insert([
      {
        identifier: approvedOrgId,
        instance_id: approvedInstanceId,
        name: 'Approved',
        email: 'a@b.de',
        active: true,
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        identifier: draftOrgId,
        instance_id: draftInstanceId,
        name: 'Draft',
        email: 'a@b.de',
        active: true,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);
    await db('endpoints').insert({
      identifier: epId,
      organization_id: approvedOrgId,
      name: 'EP',
      address: `https://${epId}/fhir`,
      created_at: new Date(),
      updated_at: new Date(),
    });
    await db('certificates').insert({
      id: uuidv4(),
      organization_id: approvedOrgId,
      pem: certPem,
      subject: 'CN=test',
      thumbprint: 'a'.repeat(64),
      valid_until: '2099-01-01',
      created_at: new Date(),
    });
    await db('memberships').insert({
      id: uuidv4(),
      organization_id: approvedOrgId,
      parent_organization: verbundId,
      endpoint_id: epId,
      roles: JSON.stringify(['DIC']),
      created_at: new Date(),
      updated_at: new Date(),
    });
    await db('approval_requests').insert({
      id: uuidv4(),
      instance_id: approvedInstanceId,
      status: 'APPROVED',
      created_at: new Date(),
      submitted_at: new Date(),
      resolved_at: new Date(),
      resolved_by: 'admin@imi-test.example.de',
      snapshot_json: JSON.stringify({}),
    });
  });

  afterAll(async () => {
    await db('memberships').where({ organization_id: approvedOrgId }).del();
    await db('certificates').where({ organization_id: approvedOrgId }).del();
    await db('endpoints').where({ identifier: epId }).del();
    await db('approval_requests')
      .whereIn('instance_id', [approvedInstanceId, draftInstanceId])
      .del();
    await db('organizations').whereIn('identifier', [approvedOrgId, draftOrgId]).del();
    await db('instances').whereIn('id', [approvedInstanceId, draftInstanceId]).del();
    await db('users').where({ id: userId }).del();
  });

  it('includes the approved org but NOT the draft org', async () => {
    const bundle = (await generateFullBundle()) as unknown as { entry: Entry[] };
    const orgIds = bundle.entry.flatMap((e) =>
      e.resource?.resourceType === 'Organization'
        ? (e.resource?.identifier ?? []).map((i) => i.value)
        : [],
    );
    expect(orgIds).toContain(approvedOrgId);
    expect(orgIds).not.toContain(draftOrgId);
  });

  it('emits the parent verbund Organization', async () => {
    const bundle = (await generateFullBundle()) as unknown as { entry: Entry[] };
    const orgIds = bundle.entry.flatMap((e) =>
      e.resource?.resourceType === 'Organization'
        ? (e.resource?.identifier ?? []).map((i) => i.value)
        : [],
    );
    expect(orgIds).toContain(verbundId);
  });

  it('attaches the SHA-512 DSF thumbprint as an extension on the org', async () => {
    const bundle = (await generateFullBundle()) as unknown as { entry: Entry[] };
    const approvedEntry = bundle.entry.find(
      (e) =>
        e.resource?.resourceType === 'Organization' &&
        (e.resource?.identifier ?? []).some((i) => i.value === approvedOrgId),
    );
    expect(approvedEntry).toBeDefined();
    const ext = approvedEntry!.resource!.extension ?? [];
    const match = ext.find(
      (x) => x.url === 'http://dsf.dev/fhir/StructureDefinition/extension-certificate-thumbprint',
    );
    expect(match).toBeDefined();
    // SHA-512 of the DER (128 lower-case hex) per DSF's hex-128-length
    // constraint — never the SHA-256 `certificates.thumbprint` column value.
    expect(match!.valueString).toBe(sha512FingerprintFromPem(certPem));
    expect(match!.valueString).toMatch(/^[a-f0-9]{128}$/);
    expect(match!.valueString).not.toBe('a'.repeat(64));
  });

  it('every internal reference resolves to a fullUrl in the same bundle', async () => {
    const bundle = (await generateFullBundle()) as unknown as { entry: Entry[]; type: string };
    // Bundle.identifier removed — DSF spec does not require it on transaction
    // bundles, and strict HAPI FHIR validators flag the custom value. Assert
    // the envelope is still a transaction bundle instead.
    expect(bundle.type).toBe('transaction');
    const fullUrls = new Set(bundle.entry.map((e) => e.fullUrl));
    const refs: string[] = [];
    for (const e of bundle.entry) {
      const r = e.resource;
      if (!r) continue; // DELETE entry
      if (r.endpoint) refs.push(...r.endpoint.map((x) => x.reference));
      if (r.managingOrganization) refs.push(r.managingOrganization.reference);
      if (r.organization) refs.push(r.organization.reference);
      if (r.participatingOrganization) refs.push(r.participatingOrganization.reference);
    }
    for (const ref of refs) {
      expect(fullUrls.has(ref)).toBe(true);
    }
  });

  it('emits DELETE OrganizationAffiliation for soft-deleted memberships', async () => {
    // Soft-delete the membership seeded in beforeAll.
    await db('memberships')
      .where({ organization_id: approvedOrgId })
      .update({ deleted_at: new Date() });

    try {
      const bundle = (await generateFullBundle()) as unknown as {
        entry: Array<{ request?: { method: string; url: string } }>;
      };
      const deleteEntry = bundle.entry.find(
        (e) =>
          e.request?.method === 'DELETE' &&
          e.request?.url.startsWith('OrganizationAffiliation?') &&
          e.request?.url.includes(`participating-organization:identifier=`) &&
          e.request?.url.includes(approvedOrgId),
      );
      expect(deleteEntry).toBeDefined();
    } finally {
      // Restore for the next test.
      await db('memberships')
        .where({ organization_id: approvedOrgId })
        .update({ deleted_at: null });
    }
  });

  it('deletes an organization whose deactivation was approved, with endpoint and affiliation', async () => {
    const withdrawn = await seedSite({
      label: 'withdrawn',
      active: false,
      memberships: [{ parent: verbundId, roles: ['DIC'] }],
    });
    // Deactivated, but the deactivation is still waiting for approval.
    const withdrawing = await seedSite({
      label: 'withdrawing',
      active: false,
      approval: 'PENDING',
    });
    try {
      const bundle = (await generateFullBundle()) as unknown as {
        entry: Array<{ request: { method: string; url: string } }>;
      };
      const deletes = bundle.entry
        .filter((e) => e.request.method === 'DELETE')
        .map((e) => e.request.url);
      expect(deletes).toEqual(
        expect.arrayContaining([
          `Organization?identifier=http://dsf.dev/sid/organization-identifier|${withdrawn.orgId}`,
          `Endpoint?identifier=http://dsf.dev/sid/endpoint-identifier|${withdrawn.endpointIds[0]}`,
          `OrganizationAffiliation?primary-organization:identifier=http://dsf.dev/sid/organization-identifier|${verbundId}` +
            `&participating-organization:identifier=http://dsf.dev/sid/organization-identifier|${withdrawn.orgId}` +
            `&endpoint:identifier=http://dsf.dev/sid/endpoint-identifier|${withdrawn.endpointIds[0]}`,
        ]),
      );
      expect(deletes.filter((url) => url.includes(withdrawing.orgId))).toEqual([]);
      // An active approved organization is never deleted.
      expect(deletes.filter((url) => url.endsWith(`|${approvedOrgId}`))).toEqual([]);
    } finally {
      await removeSites([withdrawn, withdrawing]);
    }
  });
});
