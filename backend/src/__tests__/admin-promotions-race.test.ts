/**
 * admin-promotions-race.test.ts – A promotion request is decided once: approve,
 * reject and cancel only flip a row that is still PENDING (conditional update,
 * like admin-cert-requests), so concurrent decisions cannot both succeed and
 * an approval cannot follow a rejection. Approval also re-checks, at decision
 * time, that the requester is still an admin and the target is still
 * whitelisted and unlocked.
 * Dependencies: db/connection, lib/adminGrants, admin-promotions.service
 */
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection';
import { signGrant } from '../lib/adminGrants';
import {
  approvePromotion,
  cancelPromotion,
  rejectPromotion,
} from '../services/admin-promotions.service';

const sfx = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const requester = `pr-a-${sfx}@site-a-${sfx}.example.de`;
const approver = `pr-b-${sfx}@site-b-${sfx}.example.de`;
const rejector = `pr-c-${sfx}@site-c-${sfx}.example.de`;
const admins = [requester, approver, rejector];
const targets: string[] = [];

async function grant(email: string): Promise<void> {
  const at = new Date(Math.floor(Date.now() / 1000) * 1000);
  await db('admin_grants').insert({
    email,
    granted_at: at,
    granted_by_a: 'SYSTEM:test',
    granted_by_b: 'SYSTEM:test',
    signature_hex: signGrant(email, at, 'SYSTEM:test', 'SYSTEM:test'),
  });
}

async function pendingRequest(): Promise<{ id: string; target: string }> {
  const target = `pr-t-${uuidv4().slice(0, 8)}-${sfx}@site-t.example.de`;
  targets.push(target);
  await db('email_whitelist').insert({ id: uuidv4(), email: target, created_at: new Date() });
  const id = uuidv4();
  await db('admin_promotion_requests').insert({
    id,
    target_email: target,
    requested_by: requester,
    requested_at: new Date(),
    status: 'PENDING',
  });
  return { id, target };
}

beforeAll(async () => {
  for (const email of admins) {
    await db('email_whitelist').insert({ id: uuidv4(), email, created_at: new Date() });
    await grant(email);
  }
});

afterAll(async () => {
  await db('admin_promotion_requests').whereIn('target_email', targets).del();
  await db('admin_grants')
    .whereIn('email', [...admins, ...targets])
    .del();
  await db('email_whitelist')
    .whereIn('email', [...admins, ...targets])
    .del();
  await db('audit_logs').whereIn('user_email', admins).del();
});

describe('promotion decisions', () => {
  it('lets exactly one of concurrent approve / reject / cancel win', async () => {
    for (let i = 0; i < 5; i++) {
      const { id, target } = await pendingRequest();
      const results = await Promise.allSettled([
        approvePromotion(id, approver),
        rejectPromotion(id, rejector, 'no'),
        cancelPromotion(id, requester),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const row = await db('admin_promotion_requests').where({ id }).first();
      const granted = !!(await db('admin_grants').where({ email: target }).first());
      expect(granted).toBe(row.status === 'APPROVED');
    }
  });

  it('refuses approval when the requester is no longer an admin', async () => {
    const { id, target } = await pendingRequest();
    const ghost = `pr-ghost-${sfx}@site-g-${sfx}.example.de`;
    await db('admin_promotion_requests').where({ id }).update({ requested_by: ghost });
    await expect(approvePromotion(id, approver)).rejects.toMatchObject({
      code: 'REQUESTER_NOT_ADMIN',
    });
    expect(await db('admin_grants').where({ email: target }).first()).toBeUndefined();
  });

  it('refuses approval when the target was locked or removed meanwhile', async () => {
    const locked = await pendingRequest();
    await db('email_whitelist')
      .where({ email: locked.target })
      .update({ locked_at: new Date(), locked_by: rejector });
    await expect(approvePromotion(locked.id, approver)).rejects.toMatchObject({
      code: 'TARGET_LOCKED',
    });

    const removed = await pendingRequest();
    await db('email_whitelist').where({ email: removed.target }).del();
    await expect(approvePromotion(removed.id, approver)).rejects.toMatchObject({
      code: 'NOT_WHITELISTED',
    });
  });
});
