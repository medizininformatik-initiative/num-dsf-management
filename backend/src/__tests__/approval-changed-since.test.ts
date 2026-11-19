/**
 * approval-changed-since.test.ts – changedSinceApproval reports exactly the
 * site-editable data: a changed contact e-mail / address or organization
 * e-mail counts, admin-managed or system-set values (contact e-mail
 * validation, login-certificate thumbprint) do not. Also a legacy approved
 * snapshot without the editable-fields digest never reads as changed because
 * of it.
 * Dependencies: db/connection, approval.service, helpers/allowListSites
 */
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection';
import { getApprovalStatus, submitApproval } from '../services/approval.service';
import { removeSites, seedSite, type Site } from './helpers/allowListSites';

let site: Site;
let contactId: string;

const changed = async () => (await getApprovalStatus(site.instanceId))?.changedSinceApproval;

beforeAll(async () => {
  site = await seedSite({ label: 'changed-since', approval: null });
  contactId = uuidv4();
  await db('contacts').insert({
    id: contactId,
    organization_id: site.orgId,
    types: JSON.stringify(['DSF_ADMIN']),
    name: 'Contact',
    email: 'contact@example.de',
    email_validated: 0,
    phone: '+49 251 1',
    address_line: 'Street 1',
    city: 'Muenster',
    postal_code: '48149',
    country_code: 'DE',
    created_at: new Date(),
    updated_at: new Date(),
  });
  const request = await submitApproval(site.instanceId, site.email, '127.0.0.1');
  await db('approval_requests')
    .where({ id: request.id })
    .update({ status: 'APPROVED', resolved_at: new Date() });
});

afterAll(async () => {
  await db('contacts').where({ id: contactId }).del();
  await removeSites([site]);
});

describe('changedSinceApproval', () => {
  it('is false right after the approval', async () => {
    expect(await changed()).toBe(false);
  });

  it('ignores the e-mail validation flag and the login-certificate thumbprint', async () => {
    await db('contacts').where({ id: contactId }).update({ email_validated: 1 });
    await db('organizations')
      .where({ identifier: site.orgId })
      .update({ client_cert_thumbprint: 'a'.repeat(64) });
    expect(await changed()).toBe(false);
  });

  it.each([
    [
      'contact e-mail',
      () => db('contacts').where({ id: contactId }).update({ email: 'x@example.de' }),
    ],
    [
      'contact address',
      () => db('contacts').where({ id: contactId }).update({ address_line: 'Other 2' }),
    ],
    [
      'contact postcode',
      () => db('contacts').where({ id: contactId }).update({ postal_code: '10115' }),
    ],
    [
      'organization e-mail',
      () => db('organizations').where({ identifier: site.orgId }).update({ email: 'o@example.de' }),
    ],
  ])('detects a changed %s', async (_label, edit) => {
    const [before] = [await changed()];
    expect(before).toBe(false);
    await edit();
    expect(await changed()).toBe(true);
    await db('contacts').where({ id: contactId }).update({
      email: 'contact@example.de',
      address_line: 'Street 1',
      postal_code: '48149',
    });
    await db('organizations').where({ identifier: site.orgId }).update({ email: site.email });
    expect(await changed()).toBe(false);
  });

  it('a legacy approved snapshot without the digest is not reported as changed for it', async () => {
    const approved = await db('approval_requests')
      .where({ instance_id: site.instanceId, status: 'APPROVED' })
      .first('id', 'snapshot_json');
    const snapshot =
      typeof approved.snapshot_json === 'string'
        ? JSON.parse(approved.snapshot_json)
        : approved.snapshot_json;
    delete snapshot.editableDigest;
    await db('approval_requests')
      .where({ id: approved.id })
      .update({ snapshot_json: JSON.stringify(snapshot) });
    await db('contacts').where({ id: contactId }).update({ email: 'later@example.de' });
    expect(await changed()).toBe(false);
    await db('contacts').where({ id: contactId }).update({ email: 'contact@example.de' });
  });

  it('embeds the certificate facts (no PEM) and ignores them against a legacy snapshot', async () => {
    const approved = await db('approval_requests')
      .where({ instance_id: site.instanceId, status: 'APPROVED' })
      .first('id', 'snapshot_json');
    const snapshot =
      typeof approved.snapshot_json === 'string'
        ? JSON.parse(approved.snapshot_json)
        : approved.snapshot_json;
    const cert = snapshot.certificates[0];
    expect(cert.issuerDn).toEqual(expect.any(String));
    expect(cert.subjectDn).toEqual(expect.any(String));
    expect(cert.notAfter).toEqual(expect.any(String));
    expect(Array.isArray(cert.sanDns)).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain('BEGIN CERTIFICATE');
    for (const key of ['issuerDn', 'subjectDn', 'sanDns', 'notAfter']) delete cert[key];
    await db('approval_requests')
      .where({ id: approved.id })
      .update({ snapshot_json: JSON.stringify(snapshot) });
    expect(await changed()).toBe(false);
  });
});
