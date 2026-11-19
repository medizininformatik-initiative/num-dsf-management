/**
 * certificate-purpose.test.ts – Per certificate "publish in the allow list" and "use for login"
 * (migration 040): the allow-list builder publishes only published thumbprints, the login sync
 * grants login only for login certificates (a login-only certificate never reaches a bundle, a
 * publish-only one never logs in), submitting needs at least one published certificate, changing
 * a flag is a change that needs a new approval (older snapshots without the flags read as both
 * set), a renewal inherits the flags and an admin cannot enable a certificate the site excluded
 * from login.
 * Dependencies: db, approval.service, fhir.service, certificate.service, login-certificate-sync,
 *               org-login-certificates, helpers/allowListSites
 */
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection';
import { getApprovalStatus, submitApproval } from '../services/approval.service';
import { loadAllowListInput, renderFullBundle } from '../services/fhir.service';
import { renewCertificate, updateCertificatePurpose } from '../services/certificate.service';
import { syncLoginCertificatesFromApproval } from '../services/login-certificate-sync.service';
import { enable } from '../services/org-login-certificates.service';
import { sha512FingerprintFromPem } from '../lib/certFingerprint';
import { makeCertPem, removeSites, seedSite, type Site } from './helpers/allowListSites';

const ip = '127.0.0.1';
const sites: Site[] = [];

afterAll(async () => {
  await removeSites(sites);
});

interface Spec {
  publish: boolean;
  login: boolean;
}

/** A site with one certificate per spec (clinic-uploaded), no seeded certificate. */
async function seed(label: string, specs: Spec[]) {
  const site = await seedSite({ label, certificate: false });
  sites.push(site);
  const certs: Array<{ id: string; pem: string; fp: string }> = [];
  for (const [i, spec] of specs.entries()) {
    const pem = makeCertPem(`c${i}.${site.orgId}`);
    const id = uuidv4();
    await db('certificates').insert({
      id,
      organization_id: site.orgId,
      pem,
      subject: `CN=c${i}.${site.orgId}`,
      thumbprint: uuidv4().replace(/-/g, ''),
      valid_until: new Date('2035-01-01'),
      created_at: new Date(Date.now() + i),
      uploaded_by: site.email,
      uploaded_by_admin: 0,
      publish_in_allowlist: spec.publish ? 1 : 0,
      use_for_login: spec.login ? 1 : 0,
    });
    certs.push({ id, pem, fp: sha512FingerprintFromPem(pem) });
  }
  return { site, certs };
}

/** Submit and approve (the one-approval path is enough for clinic-uploaded certificates). */
async function approve(site: Site): Promise<string> {
  await db('approval_requests').where({ instance_id: site.instanceId }).del();
  const request = await submitApproval(site.instanceId, site.email, ip);
  await db('approval_requests')
    .where({ id: request.id })
    .update({ status: 'APPROVED', resolved_at: new Date(), resolved_by: 'test' });
  return request.id;
}

describe('allow list and login follow the purpose flags', () => {
  it('publishes only published thumbprints and logs in only login certificates', async () => {
    const { site, certs } = await seed('purpose-mix', [
      { publish: true, login: true },
      { publish: false, login: true }, // login only
      { publish: true, login: false }, // allow list only
    ]);
    const [both, loginOnly, publishOnly] = certs;
    const requestId = await approve(site);

    // The snapshot carries the flags and the SHA-512 login thumbprints.
    const row = await db('approval_requests').where({ id: requestId }).first('snapshot_json');
    const snapshot =
      typeof row.snapshot_json === 'string' ? JSON.parse(row.snapshot_json) : row.snapshot_json;
    // (the snapshot lists the certificates in database order, so match them by id)
    const flagsById = new Map<string, unknown[]>(
      snapshot.certificates.map((c: Record<string, unknown>) => [
        c.id as string,
        [c.publish_in_allowlist, c.use_for_login],
      ]),
    );
    expect(flagsById.get(both.id)).toEqual([true, true]);
    expect(flagsById.get(loginOnly.id)).toEqual([false, true]);
    expect(flagsById.get(publishOnly.id)).toEqual([true, false]);
    expect([...snapshot.allowList.loginThumbprints].sort()).toEqual([both.fp, loginOnly.fp].sort());

    // The builder never sees the login-only thumbprint.
    const input = await loadAllowListInput();
    const member = input.members.find((m) => m.identifier === site.orgId);
    expect([...(member?.thumbprints ?? [])].sort()).toEqual([both.fp, publishOnly.fp].sort());
    const json = JSON.stringify(renderFullBundle(input));
    expect(json).toContain(both.fp);
    expect(json).toContain(publishOnly.fp);
    expect(json).not.toContain(loginOnly.fp);

    // Login sync: login certificates only.
    const result = await syncLoginCertificatesFromApproval(requestId);
    expect([...result.added].sort()).toEqual([both.fp, loginOnly.fp].sort());
    const logins = await db('org_login_certificates')
      .where({ organization_id: site.orgId })
      .pluck('fingerprint');
    expect([...logins].sort()).toEqual([both.fp, loginOnly.fp].sort());
    expect(logins).not.toContain(publishOnly.fp);
  });

  it('a snapshot from before the flags publishes and logs in every thumbprint', async () => {
    const { site, certs } = await seed('purpose-old', [{ publish: true, login: true }]);
    const requestId = await approve(site);
    const old = {
      allowList: {
        version: 1,
        active: true,
        member: { identifier: site.orgId, thumbprints: [certs[0].fp] },
      },
    };
    await db('approval_requests')
      .where({ id: requestId })
      .update({ snapshot_json: JSON.stringify(old) });
    const result = await syncLoginCertificatesFromApproval(requestId);
    expect(result.added).toEqual([certs[0].fp]);
  });
});

describe('submitting', () => {
  it('is refused when certificates exist but none is published', async () => {
    const { site } = await seed('purpose-none', [
      { publish: false, login: true },
      { publish: false, login: false },
    ]);
    await expect(submitApproval(site.instanceId, site.email, ip)).rejects.toThrow(
      'NO_PUBLISHED_CERTIFICATE',
    );
  });

  it('works with one published certificate, login not required', async () => {
    const { site } = await seed('purpose-pub', [{ publish: true, login: false }]);
    const request = await submitApproval(site.instanceId, site.email, ip);
    expect(request.status).toBe('PENDING');
  });
});

describe('changing a flag', () => {
  it('is a change since the approval and is audited; older snapshots read as both set', async () => {
    const { site, certs } = await seed('purpose-change', [
      { publish: true, login: true },
      { publish: true, login: true },
    ]);
    const requestId = await approve(site);
    expect((await getApprovalStatus(site.instanceId))?.changedSinceApproval).toBe(false);

    // An approved snapshot from before the flags (only the SHA-256 thumbprints) still equals.
    const row = await db('approval_requests').where({ id: requestId }).first('snapshot_json');
    const stored =
      typeof row.snapshot_json === 'string' ? JSON.parse(row.snapshot_json) : row.snapshot_json;
    for (const c of stored.certificates) {
      delete c.publish_in_allowlist;
      delete c.use_for_login;
    }
    delete stored.allowList.loginThumbprints;
    await db('approval_requests')
      .where({ id: requestId })
      .update({ snapshot_json: JSON.stringify(stored) });
    expect((await getApprovalStatus(site.instanceId))?.changedSinceApproval).toBe(false);

    const updated = await updateCertificatePurpose(
      site.instanceId,
      certs[1].id,
      { useForLogin: false },
      site.email,
      ip,
    );
    expect(updated).toMatchObject({ publishInAllowlist: true, useForLogin: false });
    expect((await getApprovalStatus(site.instanceId))?.changedSinceApproval).toBe(true);
    const audit = await db('audit_logs')
      .where({ resource_type: 'CERTIFICATE', resource_id: certs[1].id, operation: 'UPDATE' })
      .first('diff_json');
    expect(audit.diff_json).toMatchObject({
      action: 'certificate_purpose',
      useForLogin: [true, false],
    });
    await db('audit_logs').where({ resource_id: certs[1].id }).del();
  });

  it('rejects a certificate of another site', async () => {
    const { site } = await seed('purpose-own', [{ publish: true, login: true }]);
    const other = await seed('purpose-other', [{ publish: true, login: true }]);
    await expect(
      updateCertificatePurpose(site.instanceId, other.certs[0].id, { useForLogin: false }, 'x', ip),
    ).rejects.toThrow('CERTIFICATE_NOT_FOUND');
  });

  it('is inherited by the certificate that renews it', async () => {
    const { site, certs } = await seed('purpose-renew', [{ publish: false, login: true }]);
    const renewed = await renewCertificate(
      site.instanceId,
      certs[0].id,
      { pem: makeCertPem(`new.${site.orgId}`) },
      site.email,
      ip,
      false,
    );
    expect(renewed).toMatchObject({ publishInAllowlist: false, useForLogin: true });
    await db('audit_logs').where({ instance_id: site.instanceId }).del();
  });
});

describe('admin login certificates', () => {
  it('cannot enable a certificate the site excluded from login', async () => {
    const { site, certs } = await seed('purpose-admin', [
      { publish: true, login: false },
      { publish: true, login: true },
    ]);
    await expect(enable(site.orgId, certs[0].id, 'admin@imi.example.de', ip)).rejects.toThrow(
      'NOT_FOR_LOGIN',
    );
    const ok = await enable(site.orgId, certs[1].id, 'admin@imi.example.de', ip);
    expect(ok.fingerprint).toBe(certs[1].fp);
    await db('audit_logs').where({ instance_id: site.instanceId }).del();
  });
});
