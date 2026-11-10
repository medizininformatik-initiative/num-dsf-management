/**
 * instances.service.ts — DSF instance CRUD: list, create, fetch, rename,
 * archive/unarchive and delete.
 *
 * Extracted from routes/instances.routes.ts so handlers stop running
 * inline Knex queries (project rule: DB access only via the service layer).
 *
 * Dependencies: db/connection, audit.service, isAdmin, uuid
 */
import { db } from '../db/connection';
import { writeAuditLog } from './audit.service';
import { isAdminCaller } from '../lib/isAdmin';
import { v4 as uuidv4 } from 'uuid';

export type ApprovalSummaryStatus =
  | 'NONE'
  | 'DRAFT'
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'WITHDRAWN';

export interface InstanceRow {
  id: string;
  user_id: string;
  label: string;
  created_at: Date;
  archived_at?: Date | null;
  archived_by?: string | null;
}

export interface EnrichedInstanceRow extends InstanceRow {
  // Display label preference: associated org's identifier (FQDN), falling
  // back to the stored label, falling back to the raw UUID.
  label: string;
  owner_email?: string | null;
  // Newest approval request of the instance (NONE when it has none) and the
  // time of its latest approval; the dashboard overview shows both.
  approval_status?: ApprovalSummaryStatus;
  last_approved_at?: Date | null;
}

/**
 * List instances visible to the caller.
 * Admins (per admin_grants table) see every instance cross-tenant;
 * regular users see only their own. The single-instance fetch
 * (`getInstance`) already respected admin bypass — this brings the list
 * endpoint in line with that contract.
 *
 * Archived instances are hidden from their owner unless `includeArchived` is
 * set; admins and the instance's own site login always see them.
 */
export async function listForUser(
  userId: string,
  callerEmail?: string,
  scopeInstanceId?: string,
  opts: { includeArchived?: boolean } = {},
): Promise<EnrichedInstanceRow[]> {
  const isAdmin = await isAdminCaller(
    callerEmail ? { email: callerEmail, scopeInstanceId } : undefined,
  );
  const query = db<InstanceRow>('instances').orderBy('created_at', 'asc');
  // An org-scoped session sees exactly its own instance, whoever owns it.
  if (scopeInstanceId) query.where({ id: scopeInstanceId });
  else if (!isAdmin) {
    query.where({ user_id: userId });
    if (!opts.includeArchived) query.whereNull('archived_at');
  }
  const instances = await query;

  // Single fetch of the orgs that belong to these instances — replaces an
  // N+1 (one org SELECT per instance) with a single whereIn + Map lookup.
  const ids = instances.map((i) => i.id);
  const orgs =
    ids.length === 0
      ? []
      : await db('organizations').whereIn('instance_id', ids).select('instance_id', 'identifier');
  const orgByInstance = new Map<string, string>(
    orgs.map((o: { instance_id: string; identifier: string }) => [o.instance_id, o.identifier]),
  );

  const latestByInstance = new Map<string, ApprovalSummaryStatus>();
  const approvedAtByInstance = new Map<string, Date>();
  if (ids.length > 0) {
    const requests: Array<{ instance_id: string; status: ApprovalSummaryStatus }> = await db(
      'approval_requests',
    )
      .whereIn('instance_id', ids)
      .orderBy('created_at', 'desc')
      .select('instance_id', 'status');
    for (const r of requests) {
      if (!latestByInstance.has(r.instance_id)) latestByInstance.set(r.instance_id, r.status);
    }
    const approved: Array<{ instance_id: string; at: Date | null }> = await db('approval_requests')
      .whereIn('instance_id', ids)
      .where({ status: 'APPROVED' })
      .groupBy('instance_id')
      .select('instance_id')
      .max({ at: 'resolved_at' });
    for (const a of approved) if (a.at) approvedAtByInstance.set(a.instance_id, a.at);
  }

  return instances.map((inst) => ({
    ...inst,
    label: orgByInstance.get(inst.id) || inst.label || inst.id,
    approval_status: latestByInstance.get(inst.id) ?? 'NONE',
    last_approved_at: approvedAtByInstance.get(inst.id) ?? null,
  }));
}

/**
 * Create a new instance owned by the user (label defaults to the generated id) and write a CREATE audit log.
 * Throws INSTANCE_CREATE_FAILED if the inserted row cannot be read back.
 * @returns The newly created instance row.
 */
export async function createInstance(
  userId: string,
  userEmail: string,
  ipAddress: string,
): Promise<InstanceRow> {
  const id = uuidv4();
  await db('instances').insert({ id, user_id: userId, label: id, created_at: new Date() });
  await writeAuditLog({
    userEmail,
    resourceType: 'AUTH',
    resourceId: id,
    operation: 'CREATE',
    ipAddress,
  });
  const instance = await db<InstanceRow>('instances').where({ id }).first();
  // The row we just inserted must exist; assert here so callers can rely
  // on a non-null return without a redundant null-check.
  if (!instance) throw new Error('INSTANCE_CREATE_FAILED');
  return instance;
}

/**
 * Fetch one instance. Admins bypass the user_id scope; non-admins only see
 * their own instances. Returns null if the row doesn't exist OR the caller
 * isn't entitled to read it (callers should respond 404 either way to
 * avoid leaking instance existence).
 */
export async function getInstance(
  id: string,
  callerEmail: string,
  scopeInstanceId?: string,
): Promise<EnrichedInstanceRow | null> {
  if (scopeInstanceId && scopeInstanceId !== id) return null;
  const isAdmin = await isAdminCaller({ email: callerEmail, scopeInstanceId });
  // We need the caller's user_id for the non-admin path. Look it up by email.
  const caller = await db('users').where({ email: callerEmail }).select('id').first();
  const q = db<InstanceRow>('instances').where({ id });
  if (!isAdmin && !scopeInstanceId) {
    if (!caller) return null;
    q.andWhere({ user_id: caller.id });
  }
  const instance = await q.first();
  if (!instance) return null;
  const owner = await db('users').where({ id: instance.user_id }).select('email').first();
  return { ...instance, owner_email: owner?.email ?? null };
}

/**
 * Rename an instance's label. Owner-only (admins can edit other fields on
 * a user's org/contacts/etc., but renaming someone's instance label is
 * intentionally locked to the owner). Returns null if the caller doesn't
 * own the instance — routes should respond 403.
 */
export async function renameInstance(
  id: string,
  userId: string,
  label: string,
): Promise<InstanceRow | null> {
  const instance = await db<InstanceRow>('instances').where({ id, user_id: userId }).first();
  if (!instance) return null;
  await db('instances').where({ id }).update({ label });
  return { ...instance, label };
}

/**
 * Archive (or unarchive) an instance. Owner-only; returns null otherwise.
 * Only the archived_at/archived_by columns change: the organization, its
 * approval history and its place on the published allow list stay as they
 * are, so archiving never withdraws a site.
 */
async function setArchived(
  id: string,
  userId: string,
  userEmail: string,
  ipAddress: string,
  archived: boolean,
): Promise<InstanceRow | null> {
  const instance = await db<InstanceRow>('instances').where({ id, user_id: userId }).first();
  if (!instance) return null;
  const patch = archived
    ? { archived_at: new Date(), archived_by: userEmail }
    : { archived_at: null, archived_by: null };
  await db('instances').where({ id }).update(patch);
  await writeAuditLog({
    userEmail,
    instanceId: id,
    resourceType: 'AUTH',
    resourceId: id,
    operation: 'UPDATE',
    diffJson: { action: archived ? 'instance_archive' : 'instance_unarchive' },
    ipAddress,
  });
  return { ...instance, ...patch };
}

export function archiveInstance(
  id: string,
  userId: string,
  userEmail: string,
  ipAddress: string,
): Promise<InstanceRow | null> {
  return setArchived(id, userId, userEmail, ipAddress, true);
}

export function unarchiveInstance(
  id: string,
  userId: string,
  userEmail: string,
  ipAddress: string,
): Promise<InstanceRow | null> {
  return setArchived(id, userId, userEmail, ipAddress, false);
}

/** LIKE pattern matching the identifier as a quoted JSON string value. */
function quotedLike(identifier: string): string {
  return `%"${identifier.replace(/[\\%_]/g, (c) => `\\${c}`)}"%`;
}

/**
 * Delete an instance that was never approved or published, together with its
 * organization and everything below it (foreign keys cascade). Owner-only.
 *
 * @returns false when the caller does not own the instance.
 * @throws Error('INSTANCE_HAS_HISTORY') when any approval request was ever
 *   APPROVED or is PENDING, the organization appears in a stored bundle
 *   version (published or withdrawn), or an incident references it. Such an
 *   instance can only be archived.
 *
 * audit_logs has no foreign key to instances and is append-only, so its rows
 * stay; the deletion itself is audited.
 */
export async function deleteInstance(
  id: string,
  userId: string,
  userEmail: string,
  ipAddress: string,
): Promise<boolean> {
  const deleted = await db.transaction(async (trx) => {
    const instance = await trx('instances').where({ id, user_id: userId }).forUpdate().first();
    if (!instance) return false;

    const blocking = await trx('approval_requests')
      .where({ instance_id: id })
      .whereIn('status', ['APPROVED', 'PENDING'])
      .first('id');
    if (blocking) throw new Error('INSTANCE_HAS_HISTORY');

    const org = await trx('organizations').where({ instance_id: id }).first('identifier');
    if (org) {
      const pattern = quotedLike(org.identifier);
      const published = await trx('bundle_versions')
        .whereRaw('bundle_json LIKE ?', [pattern])
        .orWhereRaw('input_json LIKE ?', [pattern])
        .first('id');
      if (published) throw new Error('INSTANCE_HAS_HISTORY');
      const incident = await trx('incidents')
        .where({ organization_id: org.identifier })
        .first('id');
      if (incident) throw new Error('INSTANCE_HAS_HISTORY');
    }

    await trx('instances').where({ id }).del();
    return true;
  });
  if (!deleted) return false;
  await writeAuditLog({
    userEmail,
    instanceId: id,
    resourceType: 'AUTH',
    resourceId: id,
    operation: 'DELETE',
    diffJson: { action: 'instance_delete' },
    ipAddress,
  });
  return true;
}
