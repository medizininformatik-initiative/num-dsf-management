/**
 * admin.middleware.ts – requireImiAdmin guard
 * Dependencies: isAdmin (DB-backed admin_grants table, RS256 signed)
 *
 * Use AFTER requireAuth — relies on req.user being set.
 * IMI_ADMIN_EMAILS env var is NOT consulted; admin status is read from
 * the admin_grants table with signature verification (migration 006).
 */
import { Request, Response, NextFunction } from 'express';
import { isAdminCaller } from '../lib/isAdmin';

export async function requireImiAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  let admin: boolean;
  try {
    admin = await isAdminCaller(req.user);
  } catch (err) {
    // Express 4 does not catch a rejected promise from async middleware.
    next(err);
    return;
  }
  if (!admin) {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: 'IMI admin access required' } });
    return;
  }
  next();
}
