/**
 * instances.service.test.ts – DB-backed test for instances.service.
 * Exercises createInstance, getInstance, listForUser and renameInstance for a
 * non-admin owner (admin bypass paths are covered elsewhere), plus archive,
 * unarchive and delete of an instance.
 * Dependencies: db/connection, instances.service
 */
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection';
import {
  createInstance,
  getInstance,
  listForUser,
  renameInstance,
  archiveInstance,
  unarchiveInstance,
  deleteInstance,
} from '../services/instances.service';

describe('instances.service', () => {
  const userId = uuidv4();
  const userEmail = `inst-${Date.now()}-${uuidv4().slice(0, 8)}@example.de`;
  let createdId = '';

  beforeAll(async () => {
    await db('users').insert({
      id: userId,
      email: userEmail,
      totp_enabled: false,
      created_at: new Date(),
    });
  });

  afterAll(async () => {
    try {
      if (createdId) await db('instances').where({ id: createdId }).del();
    } finally {
      await db('users').where({ id: userId }).del();
    }
  });

  it('creates, fetches, lists and renames an instance', async () => {
    const created = await createInstance(userId, userEmail, '127.0.0.1');
    createdId = created.id;
    expect(created.user_id).toBe(userId);

    const fetched = await getInstance(createdId, userEmail);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(createdId);
    expect(fetched!.owner_email).toBe(userEmail);

    const list = await listForUser(userId, userEmail);
    expect(list.some((i) => i.id === createdId)).toBe(true);

    const renamed = await renameInstance(createdId, userId, 'new-label');
    expect(renamed!.label).toBe('new-label');
    const reFetched = await getInstance(createdId, userEmail);
    expect(reFetched!.label).toBe('new-label');
  });

  it('returns null for an unentitled caller', async () => {
    expect(await getInstance(createdId || uuidv4(), 'stranger@example.de')).toBeNull();
  });
});

describe('instances.service lifecycle', () => {
  const userId = uuidv4();
  const otherId = uuidv4();
  const userEmail = `life-${Date.now()}-${uuidv4().slice(0, 8)}@example.de`;
  const otherEmail = `life-o-${Date.now()}-${uuidv4().slice(0, 8)}@example.de`;
  const orgId = `life-${uuidv4().slice(0, 8)}.example.de`;
  const created: string[] = [];

  async function newInstance(): Promise<string> {
    const inst = await createInstance(userId, userEmail, '127.0.0.1');
    created.push(inst.id);
    return inst.id;
  }
  async function addOrg(instanceId: string): Promise<void> {
    await db('organizations').insert({
      identifier: orgId,
      instance_id: instanceId,
      name: 'Life Org',
      email: 'o@example.de',
    });
  }

  beforeAll(async () => {
    await db('users').insert([
      { id: userId, email: userEmail, totp_enabled: false, created_at: new Date() },
      { id: otherId, email: otherEmail, totp_enabled: false, created_at: new Date() },
    ]);
  });

  afterEach(async () => {
    await db('bundle_versions').where('bundle_json', 'like', `%${orgId}%`).del();
    await db('incidents').where({ title: 'life-test' }).del();
    await db('organizations').where({ identifier: orgId }).del();
  });

  afterAll(async () => {
    try {
      await db('instances').whereIn('id', created).del();
    } finally {
      await db('users').whereIn('id', [userId, otherId]).del();
    }
  });

  it('archives and unarchives, owner only, and hides archived instances from the list', async () => {
    const id = await newInstance();
    expect(await archiveInstance(id, otherId, otherEmail, '127.0.0.1')).toBeNull();

    const archived = await archiveInstance(id, userId, userEmail, '127.0.0.1');
    expect(archived!.archived_at).not.toBeNull();
    expect(archived!.archived_by).toBe(userEmail);

    expect((await listForUser(userId, userEmail)).some((i) => i.id === id)).toBe(false);
    const withArchived = await listForUser(userId, userEmail, undefined, {
      includeArchived: true,
    });
    expect(withArchived.find((i) => i.id === id)!.archived_at).not.toBeNull();

    const restored = await unarchiveInstance(id, userId, userEmail, '127.0.0.1');
    expect(restored!.archived_at).toBeNull();
    expect((await listForUser(userId, userEmail)).some((i) => i.id === id)).toBe(true);
  });

  it('archiving keeps the organization and its published membership', async () => {
    const id = await newInstance();
    await addOrg(id);
    await archiveInstance(id, userId, userEmail, '127.0.0.1');
    expect(await db('organizations').where({ instance_id: id }).first()).toBeTruthy();
  });

  it('deletes a never-published instance with its organization, only for the owner', async () => {
    const id = await newInstance();
    await addOrg(id);
    await db('approval_requests').insert({ id: uuidv4(), instance_id: id, status: 'DRAFT' });
    await db('approval_requests').insert({ id: uuidv4(), instance_id: id, status: 'REJECTED' });

    expect(await deleteInstance(id, otherId, otherEmail, '127.0.0.1')).toBe(false);
    expect(await deleteInstance(id, userId, userEmail, '127.0.0.1')).toBe(true);

    expect(await db('instances').where({ id }).first()).toBeUndefined();
    expect(await db('organizations').where({ instance_id: id }).first()).toBeUndefined();
    expect(await db('approval_requests').where({ instance_id: id }).first()).toBeUndefined();
    const audit = await db('audit_logs').where({ instance_id: id, operation: 'DELETE' }).first();
    expect(audit).toBeTruthy();
  });

  it('refuses to delete after an approval', async () => {
    const id = await newInstance();
    await db('approval_requests').insert({ id: uuidv4(), instance_id: id, status: 'APPROVED' });
    await expect(deleteInstance(id, userId, userEmail, '127.0.0.1')).rejects.toThrow(
      'INSTANCE_HAS_HISTORY',
    );
    expect(await db('instances').where({ id }).first()).toBeTruthy();
  });

  it('refuses to delete with a pending approval', async () => {
    const id = await newInstance();
    await db('approval_requests').insert({ id: uuidv4(), instance_id: id, status: 'PENDING' });
    await expect(deleteInstance(id, userId, userEmail, '127.0.0.1')).rejects.toThrow(
      'INSTANCE_HAS_HISTORY',
    );
  });

  it('refuses to delete when the organization appears in a published bundle', async () => {
    const id = await newInstance();
    await addOrg(id);
    await db('bundle_versions').insert({
      id: uuidv4(),
      triggered_by: 'MANUAL',
      triggered_by_email: userEmail,
      content_hash: 'a'.repeat(64),
      signature: 'sig',
      bundle_json: JSON.stringify({ entry: [{ value: orgId }] }),
    });
    await expect(deleteInstance(id, userId, userEmail, '127.0.0.1')).rejects.toThrow(
      'INSTANCE_HAS_HISTORY',
    );
  });

  it('refuses to delete when an incident references the organization', async () => {
    const id = await newInstance();
    await addOrg(id);
    await db('incidents').insert({
      id: uuidv4(),
      organization_id: orgId,
      title: 'life-test',
      description: 'x',
      reported_by: userEmail,
      reported_at: new Date(),
      detected_at: new Date(),
    });
    await expect(deleteInstance(id, userId, userEmail, '127.0.0.1')).rejects.toThrow(
      'INSTANCE_HAS_HISTORY',
    );
  });
});
