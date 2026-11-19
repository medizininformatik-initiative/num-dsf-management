/**
 * instance-removal.test.ts – Removing a whole site with two admins: request,
 * cancel, the cross-domain confirm rule, and the effect of an executed
 * removal (logins gone, instance hidden, pending approvals withdrawn, the next
 * allow-list version deletes the organization, its endpoints and affiliations).
 * Dependencies: db, helpers/allowListSites, instance-removal.service, fhir.service,
 *               instances.service, auth.service, bundle-versions.service
 */
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection';
import { removeSites, seedSite, type Site } from './helpers/allowListSites';
import { sha512FingerprintFromPem } from '../lib/certFingerprint';
import * as svc from '../services/instance-removal.service';
import { InstanceRemovalError } from '../services/instance-removal.service';
import { loadAllowListInput } from '../services/fhir.service';
import { listForUser } from '../services/instances.service';
import { resolveCertLogin } from '../services/auth.service';
import { submitApproval } from '../services/approval.service';
import { affiliationUrl, endpointUrl, organizationUrl } from '../lib/allowListBundle';

const sfx = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const adminA = `rm-a-${sfx}@uni-a.example.de`;
const adminA2 = `rm-a2-${sfx}@uni-a.example.de`;
const adminB = `rm-b-${sfx}@uni-b.example.de`;
const sites: Site[] = [];

afterAll(async () => {
  const ids = sites.map((s) => s.instanceId);
  if (ids.length) {
    await db('instance_removal_requests').whereIn('instance_id', ids).del();
    await db('bundle_versions').whereIn('triggered_by_email', [adminA, adminA2, adminB]).del();
    await db('approval_requests').whereIn('instance_id', ids).del();
  }
  await db('audit_logs').whereIn('user_email', [adminA, adminA2, adminB]).del();
  await removeSites(sites);
});

/** Store the site's live member as the allowList section of its approved snapshot. */
async function approveLiveState(site: Site): Promise<void> {
  const member = (await loadAllowListInput()).members.find((m) => m.identifier === site.orgId);
  if (!member) throw new Error('site not published');
  await db('approval_requests')
    .where({ instance_id: site.instanceId, status: 'APPROVED' })
    .update({ snapshot_json: JSON.stringify({ allowList: { version: 1, active: true, member } }) });
}

async function seed(label: string): Promise<Site> {
  const site = await seedSite({
    label,
    loginCert: true,
    memberships: [{ parent: 'parent-net.example.de', roles: ['DIC'] }],
  });
  sites.push(site);
  await approveLiveState(site);
  return site;
}

const code = async (p: Promise<unknown>): Promise<string> =>
  p.then(
    () => 'OK',
    (e: unknown) => (e instanceof InstanceRemovalError ? e.code : `OTHER:${String(e)}`),
  );

describe('requesting and cancelling', () => {
  it('needs a reason and refuses a second pending request', async () => {
    const site = await seed('rm-req');
    expect(await code(svc.requestRemoval(site.instanceId, '  ', adminA, 'ip'))).toBe(
      'REASON_REQUIRED',
    );
    const req = await svc.requestRemoval(site.instanceId, 'Site closed', adminA, 'ip');
    expect(req.status).toBe('PENDING');
    expect(req.organizationId).toBe(site.orgId);
    expect(await code(svc.requestRemoval(site.instanceId, 'again', adminB, 'ip'))).toBe(
      'REQUEST_ALREADY_PENDING',
    );
    // Requesting changes nothing yet.
    const inst = await db('instances').where({ id: site.instanceId }).first();
    expect(inst.removed_at).toBeNull();
    expect((await loadAllowListInput()).members.some((m) => m.identifier === site.orgId)).toBe(
      true,
    );
  });

  it('lets only the requester cancel, and a cancelled request cannot be confirmed', async () => {
    const site = await seed('rm-cancel');
    const req = await svc.requestRemoval(site.instanceId, 'Oops', adminA, 'ip');
    expect(await code(svc.cancelRemoval(req.id, adminB, 'ip'))).toBe('NOT_REQUESTER');
    await svc.cancelRemoval(req.id, adminA, 'ip');
    expect(await code(svc.confirmRemoval(req.id, adminB, 'ip'))).toBe('NOT_PENDING');
    const audit = await db('audit_logs')
      .where({ user_email: adminA, instance_id: site.instanceId })
      .select('diff_json');
    const actions = audit.map((a) => a.diff_json.action);
    expect(actions).toEqual(
      expect.arrayContaining(['instance_removal_request', 'instance_removal_cancel']),
    );
  });
});

describe('confirming', () => {
  it('refuses the requester and a second admin of the same e-mail domain', async () => {
    const site = await seed('rm-rule');
    const req = await svc.requestRemoval(site.instanceId, 'Closing', adminA, 'ip');
    expect(await code(svc.confirmRemoval(req.id, adminA, 'ip'))).toBe('SELF_CONFIRM');
    expect(await code(svc.confirmRemoval(req.id, adminA2, 'ip'))).toBe('SAME_SITE');
    const inst = await db('instances').where({ id: site.instanceId }).first();
    expect(inst.removed_at).toBeNull();
    expect(await db('instance_removal_requests').where({ id: req.id }).first('status')).toEqual({
      status: 'PENDING',
    });
  });

  it('executes: logins, instance and pending approvals are gone, the next version deletes the site', async () => {
    const site = await seed('rm-exec');
    const loginFp = sha512FingerprintFromPem(site.loginCertPem!);
    expect((await resolveCertLogin(loginFp))?.kind).toBe('org');
    const pendingId = uuidv4();
    await db('approval_requests').insert({
      id: pendingId,
      instance_id: site.instanceId,
      status: 'PENDING',
      created_at: new Date(Date.now() + 1000),
      submitted_at: new Date(),
      snapshot_json: JSON.stringify({}),
    });

    const req = await svc.requestRemoval(site.instanceId, 'Site left the network', adminA, 'ip');
    const result = await svc.confirmRemoval(req.id, adminB, 'ip');

    expect(result.published).toBe(true);
    expect(result.removal.status).toBe('CONFIRMED');
    expect(result.removal.decidedBy).toBe(adminB);

    // Logins stop.
    expect(await resolveCertLogin(loginFp)).toBeNull();
    expect(await db('org_login_certificates').where({ organization_id: site.orgId })).toHaveLength(
      0,
    );
    // Not selectable for the owner; the row is kept (soft removal).
    const owned = await listForUser(site.userId, site.email);
    expect(owned.some((i) => i.id === site.instanceId)).toBe(false);
    expect(await db('instances').where({ id: site.instanceId }).first('removed_at')).toEqual({
      removed_at: expect.any(Date),
    });
    // The pending request is withdrawn and no new one can be opened.
    expect((await db('approval_requests').where({ id: pendingId }).first()).status).toBe(
      'WITHDRAWN',
    );
    await expect(submitApproval(site.instanceId, adminB, 'ip')).rejects.toThrow('INSTANCE_REMOVED');

    // The new version deletes Organization, Endpoints and affiliations.
    const input = await loadAllowListInput();
    expect(input.members.some((m) => m.identifier === site.orgId)).toBe(false);
    const removal = input.removed.find((r) => r.identifier === site.orgId);
    expect(removal?.endpoints).toEqual(site.endpointIds);
    const version = await db('bundle_versions')
      .where({ version_number: result.versionNumber })
      .first('bundle_json', 'triggered_by');
    expect(version.triggered_by).toBe('MANUAL');
    const urls = (
      JSON.parse(version.bundle_json).entry as Array<{ request: { method: string; url: string } }>
    )
      .filter((e) => e.request.method === 'DELETE')
      .map((e) => e.request.url);
    expect(urls).toEqual(
      expect.arrayContaining([
        organizationUrl(site.orgId),
        endpointUrl(site.endpointIds[0]),
        affiliationUrl('parent-net.example.de', site.orgId, site.endpointIds[0]),
      ]),
    );
    expect(await code(svc.requestRemoval(site.instanceId, 'again', adminA, 'ip'))).toBe(
      'ALREADY_REMOVED',
    );
  });
});
