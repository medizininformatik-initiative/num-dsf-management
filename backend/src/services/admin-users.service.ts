/**
 * admin-users.service.ts – Whitelist + admin_grants CRUD.
 * - Whitelist: list, add, lock, unlock, remove (audit-logged).
 * - Admin-grants: list, demote (signature-verified, audit-logged).
 * - Demote, remove and locking an admin enforce the "≥2 unlocked admins from
 *   ≥2 distinct sites" invariant.
 * - Demotion and removal of a whitelist row also delete the e-mail's admin
 *   certificates (admin_cert_fingerprints), under the certificate floor guard
 *   (admin-certificates.service: another admin must keep a valid certificate).
 * Dependencies: db/connection, audit.service, lib/approvalState, lib/adminGrants
 */
import type { Knex } from 'knex';
import { db } from '../db/connection';
import { v4 as uuidv4 } from 'uuid';
import { writeAuditLog } from './audit.service';
import { revokeAllSessions } from './auth.service';
import { siteOfEmail } from '../lib/approvalState';
import { verifyGrant, isVerifiedAdminEmail, listVerifiedAdminEmails } from '../lib/adminGrants';
import {
  AdminCertError,
  deleteAdminCertificates,
  notifyAdminCertRemoved,
} from './admin-certificates.service';

export interface WhitelistEntry {
  email: string;
  created_at: Date;
  created_by: string | null;
  locked_at: Date | null;
  locked_by: string | null;
  locked_reason: string | null;
  is_admin: boolean;
}

export class AdminUsersError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

function lower(email: string): string {
  return email.toLowerCase().trim();
}

/**
 * Throws MIN_ADMINS_REACHED unless ≥2 verified, unlocked admins from ≥2
 * distinct sites remain without `email`. Reads all grants FOR UPDATE, so
 * concurrent demotions, removals and locks serialize instead of both passing
 * the simulated check and dropping the system below the quorum floor.
 */
async function assertQuorumWithout(
  trx: Knex.Transaction,
  email: string,
  action: 'demote' | 'remove' | 'lock',
): Promise<void> {
  const allGrants = await trx('admin_grants').forUpdate();
  const locked = new Set(
    (await trx('email_whitelist').whereNotNull('locked_at').pluck('email')).map(lower),
  );
  const remainingValid = allGrants
    .filter(verifyGrant)
    .map((g: { email: string }) => g.email)
    .filter((e: string) => e !== email && !locked.has(lower(e)));
  const remainingSites = new Set(remainingValid.map(siteOfEmail).filter(Boolean));
  if (remainingValid.length < 2 || remainingSites.size < 2) {
    throw new AdminUsersError(
      'MIN_ADMINS_REACHED',
      `Cannot ${action}: at least 2 unlocked admins from 2 different sites must remain`,
    );
  }
}

/**
 * Deletes an admin grant only if the quorum floor holds afterwards, together
 * with the e-mail's admin certificates (same transaction, under the
 * certificate floor guard: some admin other than `actor` must keep a valid
 * certificate). Mails the certificate removal after commit.
 * @returns the number of admin certificates removed
 * @throws AdminUsersError MIN_ADMINS_REACHED / LAST_OTHER_ADMIN_CERT
 */
async function deleteGrantWithQuorumGuard(
  email: string,
  action: 'demote' | 'remove',
  actor: string,
): Promise<number> {
  const removed = await db.transaction(async (trx) => {
    await assertQuorumWithout(trx, email, action);
    const certs = await deleteCertsGuarded(trx, email, actor);
    await trx('admin_grants').where({ email }).del();
    return certs;
  });
  await notifyAdminCertRemoved(
    email,
    actor,
    removed.map((c) => c.fingerprint),
  );
  return removed.length;
}

/** deleteAdminCertificates with its error mapped to an AdminUsersError. */
async function deleteCertsGuarded(
  trx: Knex.Transaction,
  email: string,
  actor: string,
): Promise<Array<{ fingerprint: string }>> {
  try {
    return await deleteAdminCertificates(trx, email, actor);
  } catch (err) {
    if (err instanceof AdminCertError && err.code === 'LAST_OTHER_ADMIN_CERT') {
      throw new AdminUsersError(
        'LAST_OTHER_ADMIN_CERT',
        'No other admin would keep a valid admin certificate',
      );
    }
    throw err;
  }
}

export async function listWhitelist(): Promise<WhitelistEntry[]> {
  const rows = await db('email_whitelist').orderBy('created_at', 'asc');
  const adminSet = new Set(await listVerifiedAdminEmails());
  return rows.map((r) => ({
    email: r.email,
    created_at: r.created_at,
    created_by: r.created_by,
    locked_at: r.locked_at ?? null,
    locked_by: r.locked_by ?? null,
    locked_reason: r.locked_reason ?? null,
    is_admin: adminSet.has(r.email),
  }));
}

export async function addToWhitelist(
  rawEmail: string,
  addedBy: string,
  ipAddress?: string,
): Promise<void> {
  const email = lower(rawEmail);
  const existing = await db('email_whitelist').where({ email }).first();
  if (existing) throw new AdminUsersError('ALREADY_EXISTS', 'Email already whitelisted');
  await db('email_whitelist').insert({
    id: uuidv4(),
    email,
    created_at: new Date(),
    created_by: addedBy,
  });
  await writeAuditLog({
    userEmail: addedBy,
    resourceType: 'AUTH',
    resourceId: email,
    operation: 'CREATE',
    diffJson: { whitelist_action: 'ADD', email },
    ipAddress,
  }).catch(() => {});
}

export async function lockWhitelistEntry(
  rawEmail: string,
  lockedBy: string,
  reason: string,
  ipAddress?: string,
): Promise<void> {
  const email = lower(rawEmail);
  if (email === lower(lockedBy)) {
    throw new AdminUsersError('CANNOT_LOCK_SELF', 'You cannot lock your own account');
  }
  const existing = await db('email_whitelist').where({ email }).first();
  if (!existing) throw new AdminUsersError('NOT_FOUND', 'Email not in whitelist');
  await db.transaction(async (trx) => {
    // Locking an admin takes it out of the quorum like a demotion does.
    if (await isVerifiedAdminEmail(email)) await assertQuorumWithout(trx, email, 'lock');
    await trx('email_whitelist')
      .where({ email })
      .update({
        locked_at: new Date(),
        locked_by: lockedBy,
        locked_reason: reason || null,
      });
  });
  await revokeAllSessions(email).catch(() => {});
  await writeAuditLog({
    userEmail: lockedBy,
    resourceType: 'AUTH',
    resourceId: email,
    operation: 'UPDATE',
    diffJson: { whitelist_action: 'LOCK', email, reason },
    ipAddress,
  }).catch(() => {});
}

export async function unlockWhitelistEntry(
  rawEmail: string,
  unlockedBy: string,
  ipAddress?: string,
): Promise<void> {
  const email = lower(rawEmail);
  const existing = await db('email_whitelist').where({ email }).first();
  if (!existing) throw new AdminUsersError('NOT_FOUND', 'Email not in whitelist');
  await db('email_whitelist').where({ email }).update({
    locked_at: null,
    locked_by: null,
    locked_reason: null,
  });
  await writeAuditLog({
    userEmail: unlockedBy,
    resourceType: 'AUTH',
    resourceId: email,
    operation: 'UPDATE',
    diffJson: { whitelist_action: 'UNLOCK', email },
    ipAddress,
  }).catch(() => {});
}

export async function demoteAdmin(
  rawEmail: string,
  demotedBy: string,
  ipAddress?: string,
): Promise<void> {
  const email = lower(rawEmail);
  if (email === lower(demotedBy)) {
    throw new AdminUsersError('CANNOT_DEMOTE_SELF', 'You cannot demote yourself');
  }
  if (!(await isVerifiedAdminEmail(email))) {
    throw new AdminUsersError('NOT_AN_ADMIN', 'Email is not a verified admin');
  }
  // The admin certificates go with the grant: without them the e-mail can no
  // longer present an admin certificate at all.
  const removedCerts = await deleteGrantWithQuorumGuard(email, 'demote', demotedBy);
  await revokeAllSessions(email).catch(() => {});
  await writeAuditLog({
    userEmail: demotedBy,
    resourceType: 'AUTH',
    resourceId: email,
    operation: 'DELETE',
    diffJson: { admin_action: 'DEMOTE', email, admin_certificates_removed: removedCerts },
    ipAddress,
  }).catch(() => {});
}

export async function removeFromWhitelist(
  rawEmail: string,
  removedBy: string,
  ipAddress?: string,
): Promise<void> {
  const email = lower(rawEmail);
  if (email === lower(removedBy)) {
    throw new AdminUsersError('CANNOT_REMOVE_SELF', 'You cannot remove yourself');
  }
  const existing = await db('email_whitelist').where({ email }).first();
  if (!existing) throw new AdminUsersError('NOT_FOUND', 'Email not in whitelist');

  const adminFlag = await isVerifiedAdminEmail(email);
  let removedCerts: number;
  if (adminFlag) {
    // Removing an admin counts as demotion + removal — apply min-admins guard;
    // its admin certificates go in the same step (certificate floor guard).
    removedCerts = await deleteGrantWithQuorumGuard(email, 'remove', removedBy);
  } else {
    // Leftover certificates of a non-admin go too (never restricted).
    const certs = await db.transaction((trx) => deleteCertsGuarded(trx, email, removedBy));
    removedCerts = certs.length;
  }
  await db('email_whitelist').where({ email }).del();
  await revokeAllSessions(email).catch(() => {});
  await writeAuditLog({
    userEmail: removedBy,
    resourceType: 'AUTH',
    resourceId: email,
    operation: 'DELETE',
    diffJson: {
      whitelist_action: 'REMOVE',
      email,
      was_admin: adminFlag,
      admin_certificates_removed: removedCerts,
    },
    ipAddress,
  }).catch(() => {});
}
