/**
 * seed-hackathon.ts – Repeatable "hackathon" seed: N fictional users, each
 * signing in by client certificate only (no OTP/TOTP), each an IMI admin
 * owning a complete dummy site (organization, 2 contacts, 2 endpoints with
 * IPs, 1 certificate, 2 memberships, 1 PENDING approval request) so
 * participants have real data to edit, can onboard new sites, and can
 * approve/reject each other's requests (the 4-eyes rule needs the different
 * email domains the manifest already gives each user — see
 * lib/approvalState.ts's siteOfEmail).
 *
 * Usage:
 *   node dist/db/seed-hackathon.js <manifest.json>
 * (also runs under `npx ts-node src/db/seed-hackathon.ts <manifest.json>` in
 * dev — same duality as seed-testdata.ts / seed-whitelist.ts. The prod image
 * ships only dist/, so the prod/CI invocation MUST use the compiled .js.)
 *
 * Each user is processed in its own DB transaction so one bad row does not
 * roll back the others (mirrors onboarding.service.ts's importSites). Prior
 * rows for the same email/orgIdentifier are deleted first, so re-running the
 * same (or an edited) manifest is idempotent. Never logs a full fingerprint
 * or any PEM — only the first 16 hex chars of a fingerprint ever reach stdout.
 *
 * Dependencies: db/connection, lib/adminGrants (signGrant),
 * services/audit.service (writeAuditLog), ./hackathon/manifestSchema,
 * ./hackathon/buildSiteRows.
 */
import 'dotenv/config';
import fs from 'fs';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { db } from './connection';
import { signGrant } from '../lib/adminGrants';
import { writeAuditLog } from '../services/audit.service';
import {
  hackathonManifestSchema,
  type HackathonManifest,
  type HackathonUser,
} from './hackathon/manifestSchema';
import { buildSiteRows, buildCertificateRow } from './hackathon/buildSiteRows';

const SEEDED_BY = 'SYSTEM:hackathon';
// RFC 5737 (TEST-NET-2) — used only as the audit log's ip_address, never a real address.
const SEED_IP = '198.51.100.1';

/**
 * Refuses to run against a PRODUCTION environment unless explicitly
 * overridden. This seed grants every fictional user full IMI admin rights
 * (see hackathon-prepare.sh), so running it against a real deployment by
 * accident would hand out real admin access.
 */
export function assertSeedAllowed(env: NodeJS.ProcessEnv): void {
  if (env.DSF_ENVIRONMENT === 'PRODUCTION' && env.HACKATHON_ALLOW_PRODUCTION !== '1') {
    console.error(
      'Refusing to run the hackathon seed: DSF_ENVIRONMENT=PRODUCTION. This seed creates full ' +
        'IMI admins. Set HACKATHON_ALLOW_PRODUCTION=1 to override.',
    );
    process.exit(1);
  }
}

interface SeedSummaryRow {
  email: string;
  org: string;
  admin: boolean;
  fingerprintPrefix: string;
}

function loadManifest(manifestPath: string): HackathonManifest {
  let raw: string;
  try {
    raw =
      manifestPath === '-' ? fs.readFileSync(0, 'utf-8') : fs.readFileSync(manifestPath, 'utf-8');
  } catch (err) {
    console.error(`Cannot read manifest file "${manifestPath}": ${(err as Error).message}`);
    process.exit(1);
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    console.error(`Manifest file "${manifestPath}" is not valid JSON`);
    process.exit(1);
  }

  const result = hackathonManifestSchema.safeParse(json);
  if (!result.success) {
    console.error('Manifest validation failed:');
    for (const issue of result.error.issues) {
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }
  return result.data;
}

/**
 * Remove any rows a previous hackathon seed left behind for this email or
 * this orgIdentifier (either may have moved to a different pairing between
 * runs of an edited manifest). users/instances cascade to organizations,
 * contacts, endpoints, endpoint_ips, certificates, memberships and
 * approval_requests (see db/migrations/001_initial_schema.sql); admin_grants,
 * admin_cert_fingerprints and email_whitelist have no FK to users, so they
 * are cleaned explicitly. audit_logs is append-only at the DB level
 * (migration 013) and is intentionally never touched here.
 */
async function cleanPriorSeed(
  trx: Knex.Transaction,
  email: string,
  orgIdentifier: string,
): Promise<void> {
  const staleOrg = await trx('organizations').where({ identifier: orgIdentifier }).first();
  if (staleOrg) {
    await trx('instances').where({ id: staleOrg.instance_id }).del();
  }
  const staleUser = await trx('users').where({ email }).first();
  if (staleUser) {
    await trx('instances').where({ user_id: staleUser.id }).del();
    await trx('users').where({ id: staleUser.id }).del();
  }
  await trx('admin_grants').where({ email }).del();
  await trx('admin_cert_fingerprints').where({ email }).del();
  await trx('email_whitelist').where({ email }).del();
}

async function seedUser(user: HackathonUser, parentOrganization: string): Promise<SeedSummaryRow> {
  const now = new Date();

  const instanceId = await db.transaction(async (trx) => {
    await cleanPriorSeed(trx, user.email, user.orgIdentifier);

    const userId = uuidv4();
    await trx('users').insert({
      id: userId,
      email: user.email,
      totp_enabled: true,
      created_at: now,
    });
    await trx('email_whitelist').insert({
      id: uuidv4(),
      email: user.email,
      created_by: SEEDED_BY,
      created_at: now,
    });

    if (user.admin) {
      // MySQL TIMESTAMP truncates to whole seconds; sign the SAME rounded
      // value that gets stored, or verifyGrant fails on round-trip (see
      // admin-bootstrap.service.ts).
      const grantedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
      const signatureHex = signGrant(user.email, grantedAt, SEEDED_BY, SEEDED_BY);
      await trx('admin_grants').insert({
        email: user.email,
        granted_at: grantedAt,
        granted_by_a: SEEDED_BY,
        granted_by_b: SEEDED_BY,
        signature_hex: signatureHex,
      });
      await trx('admin_cert_fingerprints').insert({
        id: uuidv4(),
        email: user.email,
        fingerprint: user.fingerprintSha512,
        created_at: now,
        created_by: SEEDED_BY,
      });
    }

    const newInstanceId = uuidv4();
    await trx('instances').insert({
      id: newInstanceId,
      user_id: userId,
      label: user.orgIdentifier,
      created_at: now,
    });

    const site = buildSiteRows(user, parentOrganization);
    const organizationRow = { ...site.organization, instance_id: newInstanceId };
    await trx('organizations').insert(organizationRow);
    await trx('contacts').insert(site.contacts);
    await trx('endpoints').insert(site.endpoints);
    await trx('endpoint_ips').insert(site.endpointIps);
    await trx('memberships').insert(site.memberships);

    const certRow = buildCertificateRow(user.orgIdentifier, user.certPem);
    await trx('certificates').insert(certRow);

    // Snapshot shape mirrors seed-testdata.ts's seedSnapshot so the Approval
    // Review page has a full org card to render.
    const snapshot = {
      organization: organizationRow,
      contacts: site.contacts,
      endpoints: site.endpoints.map((ep) => ({
        ...ep,
        ips: site.endpointIps.filter((ip) => ip.endpoint_id === ep.identifier),
      })),
      certificates: [
        {
          id: certRow.id,
          subject: certRow.subject,
          thumbprint: certRow.thumbprint,
          valid_until: certRow.valid_until,
        },
      ],
      memberships: site.memberships,
      snapshotAt: new Date().toISOString(),
    };
    await trx('approval_requests').insert({
      id: uuidv4(),
      instance_id: newInstanceId,
      status: 'PENDING',
      created_at: now,
      submitted_at: now,
      snapshot_json: JSON.stringify(snapshot),
    });

    return newInstanceId;
  });

  // Audit write happens after commit (writeAuditLog is failure-tolerant and
  // uses the shared pool, not the transaction — same convention as
  // approval.service.ts).
  await writeAuditLog({
    userEmail: user.email,
    instanceId,
    resourceType: 'ORGANIZATION',
    resourceId: user.orgIdentifier,
    operation: 'CREATE',
    diffJson: { seed: 'hackathon', fingerprintPrefix: user.fingerprintSha512.slice(0, 16) },
    ipAddress: SEED_IP,
  });

  return {
    email: user.email,
    org: user.orgIdentifier,
    admin: user.admin,
    fingerprintPrefix: user.fingerprintSha512.slice(0, 16),
  };
}

async function main(): Promise<void> {
  assertSeedAllowed(process.env);

  const manifestPath = process.argv[2];
  if (!manifestPath) {
    console.error(
      'Usage: node dist/db/seed-hackathon.js <manifest.json | -> (- reads the manifest from stdin)',
    );
    process.exit(1);
  }
  const manifest = loadManifest(manifestPath);

  console.log(`Seeding ${manifest.users.length} hackathon user(s)...\n`);

  const summary: SeedSummaryRow[] = [];
  const failures: { email: string; issue: string }[] = [];

  for (const user of manifest.users) {
    try {
      const row = await seedUser(user, manifest.parentOrganization);
      summary.push(row);
      console.log(`  [+] ${row.email} (${row.org})`);
    } catch (err) {
      const issue = err instanceof Error ? err.message : 'UNKNOWN_ERROR';
      failures.push({ email: user.email, issue });
      console.error(`  [!] ${user.email} (${user.orgIdentifier}) FAILED: ${issue}`);
    }
  }

  if (summary.length > 0) {
    console.log('\n--- Hackathon seed summary ---');
    console.table(
      summary.map((s) => ({
        email: s.email,
        org: s.org,
        admin: s.admin,
        fingerprintPrefix: `${s.fingerprintPrefix}...`,
      })),
    );
  }

  await db.destroy();

  if (failures.length > 0) {
    console.error(`\n${failures.length} of ${manifest.users.length} user(s) failed to seed:`);
    for (const f of failures) console.error(`  - ${f.email}: ${f.issue}`);
    process.exit(1);
  }
  console.log(`\nDone: ${summary.length} hackathon user(s) seeded.`);
  process.exit(0);
}

// Run when invoked directly, skip when imported (e.g. by tests).
if (require.main === module) {
  main().catch((err) => {
    console.error('Hackathon seed failed:', err);
    process.exit(1);
  });
}
