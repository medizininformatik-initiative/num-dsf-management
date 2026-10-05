/**
 * allow-list-approved-snapshot.test.ts – The published allow list contains,
 * per site, exactly the data of the site's LATEST APPROVED request: unreviewed
 * live edits and newer pending/rejected/withdrawn requests change nothing.
 * Covers the allowList section written at submit, legacy snapshots, NULL
 * snapshots, deactivation, the IP address list and the network map.
 * Dependencies: db/connection, approval.service, fhir.service, excel.service,
 *               network.service, helpers/allowListSites
 */
import ExcelJS from 'exceljs';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection';
import { submitApproval } from '../services/approval.service';
import { dsfThumbprint, loadAllowListInput } from '../services/fhir.service';
import { generateIpAddressListExcel } from '../services/excel.service';
import { getNetworkMap } from '../services/network.service';
import {
  makeCertPem,
  removeSites,
  seedSite,
  type Site,
  type SiteSpec,
} from './helpers/allowListSites';

const sites: Site[] = [];
const pause = () => new Promise((resolve) => setTimeout(resolve, 8));

async function newSite(spec: Partial<SiteSpec> = {}): Promise<Site> {
  const site = await seedSite({
    label: 'approved-snap',
    approval: null,
    memberships: [{ parent: 'hub.example.de', roles: ['DIC'] }],
    ...spec,
  });
  sites.push(site);
  return site;
}

/** Submit the live state and approve it, as the four-eyes flow would end up. */
async function submitAndApprove(site: Site): Promise<string> {
  await pause();
  const request = await submitApproval(site.instanceId, site.email, '127.0.0.1');
  await db('approval_requests')
    .where({ id: request.id })
    .update({ status: 'APPROVED', resolved_at: new Date() });
  return request.id as string;
}

async function memberOf(site: Site) {
  const input = await loadAllowListInput();
  return input.members.find((m) => m.identifier === site.orgId);
}

async function removalOf(site: Site) {
  const input = await loadAllowListInput();
  return input.removed.find((r) => r.identifier === site.orgId);
}

async function insertRequest(
  site: Site,
  status: string,
  snapshot: unknown,
  createdAt = new Date(),
): Promise<string> {
  const id = uuidv4();
  await db('approval_requests').insert({
    id,
    instance_id: site.instanceId,
    status,
    created_at: createdAt,
    submitted_at: createdAt,
    snapshot_json: snapshot === null ? null : JSON.stringify(snapshot),
  });
  return id;
}

afterAll(async () => {
  await removeSites(sites);
});

describe('snapshot written at submit', () => {
  it('stores the allow-list member with thumbprints and never a certificate PEM', async () => {
    const site = await newSite();
    const requestId = await submitAndApprove(site);
    const row = await db('approval_requests').where({ id: requestId }).first();
    const snapshot =
      typeof row.snapshot_json === 'string' ? JSON.parse(row.snapshot_json) : row.snapshot_json;
    expect(JSON.stringify(snapshot)).not.toMatch(/BEGIN CERTIFICATE|PRIVATE KEY/);
    const cert = await db('certificates').where({ organization_id: site.orgId }).first();
    expect(snapshot.allowList).toMatchObject({
      version: 1,
      active: true,
      member: {
        identifier: site.orgId,
        thumbprints: [dsfThumbprint(cert)],
        endpoints: [
          { identifier: site.endpointIds[0], address: `https://${site.endpointIds[0]}/fhir` },
        ],
        affiliations: [{ parent: 'hub.example.de', endpoint: site.endpointIds[0], roles: ['DIC'] }],
      },
    });
    expect(snapshot.organization.identifier).toBe(site.orgId);
  });
});

describe('unreviewed live edits stay out', () => {
  it('keeps the approved endpoint, certificates and memberships after edits without resubmitting', async () => {
    const site = await newSite({
      memberships: [
        { parent: 'hub.example.de', roles: ['DIC'] },
        { parent: 'other-hub.example.de', roles: ['HRP'] },
      ],
    });
    await submitAndApprove(site);
    const before = await memberOf(site);
    expect(before?.affiliations).toHaveLength(2);

    await db('endpoints')
      .where({ identifier: site.endpointIds[0] })
      .update({ address: 'https://changed.example.de/fhir' });
    const { parseCertificate } = await import('../services/certificate.service');
    const extraPem = makeCertPem(`extra.${site.orgId}`);
    const parsed = parseCertificate(extraPem);
    await db('certificates').insert({
      id: uuidv4(),
      organization_id: site.orgId,
      pem: extraPem,
      subject: parsed.subject,
      thumbprint: parsed.thumbprint,
      valid_until: parsed.validUntil,
      created_at: new Date(),
    });
    await db('memberships')
      .where({ organization_id: site.orgId, parent_organization: 'other-hub.example.de' })
      .update({ deleted_at: new Date() });
    await db('organizations').where({ identifier: site.orgId }).update({ name: 'Renamed Live' });

    const after = await memberOf(site);
    expect(after).toEqual(before);
  });

  it.each(['PENDING', 'REJECTED', 'WITHDRAWN'])(
    'keeps the approved data when a newer %s request carries other data',
    async (status) => {
      const site = await newSite();
      await submitAndApprove(site);
      const before = await memberOf(site);
      await db('endpoints')
        .where({ identifier: site.endpointIds[0] })
        .update({ address: 'https://pending-change.example.de/fhir' });
      await pause();
      await insertRequest(site, status, {
        organization: { identifier: site.orgId, active: false },
        endpoints: [],
        memberships: [],
      });
      expect(await memberOf(site)).toEqual(before);
      expect(await removalOf(site)).toBeUndefined();
    },
  );

  it('publishes the new data once the changed request is approved', async () => {
    const site = await newSite();
    await submitAndApprove(site);
    await db('endpoints')
      .where({ identifier: site.endpointIds[0] })
      .update({ address: 'https://approved-change.example.de/fhir' });
    expect((await memberOf(site))?.endpoints[0].address).toBe(
      `https://${site.endpointIds[0]}/fhir`,
    );
    await submitAndApprove(site);
    expect((await memberOf(site))?.endpoints[0].address).toBe(
      'https://approved-change.example.de/fhir',
    );
  });

  it('does not list a site that was never approved', async () => {
    const site = await newSite();
    await pause();
    await submitApproval(site.instanceId, site.email, '127.0.0.1');
    expect(await memberOf(site)).toBeUndefined();
    expect(await removalOf(site)).toBeUndefined();
  });
});

describe('deactivation', () => {
  it('an approved deactivation becomes a removed organization', async () => {
    const site = await newSite();
    await submitAndApprove(site);
    await db('organizations').where({ identifier: site.orgId }).update({ active: false });
    await submitAndApprove(site);
    expect(await memberOf(site)).toBeUndefined();
    expect(await removalOf(site)).toEqual({
      identifier: site.orgId,
      endpoints: [site.endpointIds[0]],
      affiliations: [{ parent: 'hub.example.de', endpoint: site.endpointIds[0] }],
    });
  });

  it('a pending deactivation changes nothing yet', async () => {
    const site = await newSite();
    await submitAndApprove(site);
    const before = await memberOf(site);
    await db('organizations').where({ identifier: site.orgId }).update({ active: false });
    await pause();
    await submitApproval(site.instanceId, site.email, '127.0.0.1');
    expect(await memberOf(site)).toEqual(before);
    expect(await removalOf(site)).toBeUndefined();
  });
});

describe('snapshots without the allowList section', () => {
  it('derives a legacy snapshot, taking thumbprints from the live certificates by id', async () => {
    const site = await newSite();
    const cert = await db('certificates').where({ organization_id: site.orgId }).first();
    await insertRequest(site, 'APPROVED', {
      organization: { identifier: site.orgId, name: 'Legacy Name', active: true },
      endpoints: [
        {
          identifier: site.endpointIds[0],
          name: 'legacy-ep',
          address: 'https://legacy.example.de/fhir',
          ipAddresses: [],
        },
      ],
      certificates: [{ id: cert.id }],
      memberships: [
        {
          parent_organization: 'legacy-hub.example.de',
          endpoint_id: site.endpointIds[0],
          roles: '["DIC","HRP"]',
        },
      ],
    });
    // Added after the approval: not part of the approved state.
    const lateFresh = makeCertPem(`late.${site.orgId}`);
    await db('certificates').insert({
      id: uuidv4(),
      organization_id: site.orgId,
      pem: lateFresh,
      subject: 'late',
      thumbprint: 'a'.repeat(64),
      valid_until: new Date('2035-01-01'),
      created_at: new Date(),
    });
    await db('endpoints')
      .where({ identifier: site.endpointIds[0] })
      .update({ address: 'https://live-edit.example.de/fhir' });

    expect(await memberOf(site)).toEqual({
      identifier: site.orgId,
      name: 'Legacy Name',
      thumbprints: [dsfThumbprint(cert)],
      endpoints: [
        {
          identifier: site.endpointIds[0],
          name: 'legacy-ep',
          address: 'https://legacy.example.de/fhir',
        },
      ],
      affiliations: [
        { parent: 'legacy-hub.example.de', endpoint: site.endpointIds[0], roles: ['DIC', 'HRP'] },
      ],
      removedAffiliations: [],
    });
  });

  it('uses the live certificates when none of the approved legacy certificates exists any more', async () => {
    const site = await newSite();
    await insertRequest(site, 'APPROVED', {
      organization: { identifier: site.orgId, name: 'Renewed', active: true },
      endpoints: [{ identifier: site.endpointIds[0], name: null, address: 'https://r.example.de' }],
      certificates: [{ id: uuidv4() }],
      memberships: [],
    });
    const live = await db('certificates').where({ organization_id: site.orgId }).first();
    expect((await memberOf(site))?.thumbprints).toEqual([dsfThumbprint(live)]);
  });

  it('derives a legacy deactivation as a removed organization', async () => {
    const site = await newSite();
    await insertRequest(site, 'APPROVED', {
      organization: { identifier: site.orgId, name: 'Gone', active: false },
      endpoints: [{ identifier: site.endpointIds[0], name: null, address: 'https://x.example.de' }],
      certificates: [],
      memberships: [
        { parent_organization: 'hub.example.de', endpoint_id: site.endpointIds[0], roles: ['DIC'] },
      ],
    });
    expect(await memberOf(site)).toBeUndefined();
    expect((await removalOf(site))?.endpoints).toEqual([site.endpointIds[0]]);
  });

  it.each([
    ['NULL', null],
    ['empty', {}],
  ])('falls back to the live data for a %s snapshot', async (_label, snapshot) => {
    const site = await newSite();
    await insertRequest(site, 'APPROVED', snapshot);
    const member = await memberOf(site);
    expect(member?.endpoints.map((e) => e.identifier)).toEqual([site.endpointIds[0]]);
    expect(member?.thumbprints).toHaveLength(1);
  });
});

describe('IP address list and network map follow the approved state', () => {
  it('exports the approved IP and keeps the site while a change is pending', async () => {
    const site = await newSite();
    await db('endpoint_ips').insert({
      id: uuidv4(),
      endpoint_id: site.endpointIds[0],
      ip: '10.55.0.1',
      is_fhir: 1,
      is_bpe: 0,
    });
    await submitAndApprove(site);
    await db('endpoint_ips').insert({
      id: uuidv4(),
      endpoint_id: site.endpointIds[0],
      ip: '10.55.0.2',
      is_fhir: 1,
      is_bpe: 0,
    });
    await pause();
    await submitApproval(site.instanceId, site.email, '127.0.0.1');

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(
      (await generateIpAddressListExcel()) as unknown as Parameters<typeof wb.xlsx.load>[0],
    );
    const ips: string[] = [];
    wb.getWorksheet('IP Address List')!.eachRow((row, n) => {
      if (n > 1) ips.push(String(row.getCell(5).value));
    });
    expect(ips).toContain('10.55.0.1');
    expect(ips).not.toContain('10.55.0.2');
  });

  it('shows the approved endpoint and affiliations while a change is pending', async () => {
    const site = await newSite();
    await submitAndApprove(site);
    await db('endpoints')
      .where({ identifier: site.endpointIds[0] })
      .update({ address: 'https://map-live-edit.example.de/fhir' });
    await db('memberships')
      .where({ organization_id: site.orgId })
      .update({ deleted_at: new Date() });
    await pause();
    await submitApproval(site.instanceId, site.email, '127.0.0.1');

    const { organizations } = await getNetworkMap({ isAdmin: true });
    const found = organizations.find(
      (o: { identifier: string }) => o.identifier === site.orgId,
    ) as unknown as {
      endpoints: Array<{ address: string }>;
      memberships: Array<{ parent_organization: string }>;
    };
    expect(found).toBeTruthy();
    expect(found.endpoints[0].address).toBe(`https://${site.endpointIds[0]}/fhir`);
    expect(found.memberships.map((m) => m.parent_organization)).toEqual(['hub.example.de']);
  });
});
