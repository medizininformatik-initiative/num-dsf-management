/**
 * admin-cert-expiry.service.ts – Daily warning mails for expiring admin
 * login certificates (part of the 08:00 UTC cert-check job).
 *
 * An admin certificate whose valid_until is exactly 30, 14, 7, 3 or 1 days
 * ahead (UTC calendar days) triggers one mail to its admin, unless the same
 * admin owns ANOTHER certificate that is still valid beyond that date (the
 * successor is already in place). last_warned_at makes a restart on the same
 * day send nothing twice. selectAdminCertWarnings is pure and tested alone.
 *
 * Dependencies: db/connection, notification.service, lib/adminGrants, lib/logger
 */
import { db } from '../db/connection';
import { sendAdminCertExpiryWarning } from './notification.service';
import { isVerifiedAdminEmail } from '../lib/adminGrants';
import { logger } from '../lib/logger';

export const ADMIN_CERT_WARN_DAYS = [30, 14, 7, 3, 1];

export interface AdminCertExpiryRow {
  id: string;
  email: string;
  subject: string | null;
  valid_until: Date | string | null;
  last_warned_at: Date | string | null;
}

export interface AdminCertWarning {
  id: string;
  email: string;
  subject: string;
  daysLeft: number;
  validUntil: string;
}

const utcDay = (d: Date): number => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/**
 * Which certificates get a mail today. Pure.
 * @param rows every admin certificate (all admins, so successors are visible)
 */
export function selectAdminCertWarnings(rows: AdminCertExpiryRow[], now: Date): AdminCertWarning[] {
  const today = utcDay(now);
  const expiry = (r: AdminCertExpiryRow): Date | null =>
    r.valid_until ? new Date(r.valid_until) : null;
  const out: AdminCertWarning[] = [];
  for (const r of rows) {
    const until = expiry(r);
    if (!until || Number.isNaN(until.getTime())) continue;
    const daysLeft = Math.round((utcDay(until) - today) / 86400000);
    if (!ADMIN_CERT_WARN_DAYS.includes(daysLeft)) continue;
    if (r.last_warned_at && utcDay(new Date(r.last_warned_at)) >= today) continue;
    const successor = rows.some((o) => {
      if (o.id === r.id || o.email.toLowerCase() !== r.email.toLowerCase()) return false;
      const ou = expiry(o);
      return !!ou && ou.getTime() > until.getTime();
    });
    if (successor) continue;
    out.push({
      id: r.id,
      email: r.email,
      subject: r.subject ?? '',
      daysLeft,
      validUntil: until.toISOString().slice(0, 10),
    });
  }
  return out;
}

/** Send today's admin certificate warnings; returns the number of mails sent. */
export async function runAdminCertExpiryCheck(now: Date = new Date()): Promise<number> {
  const rows: AdminCertExpiryRow[] = await db('admin_cert_fingerprints').select(
    'id',
    'email',
    'subject',
    'valid_until',
    'last_warned_at',
  );
  let sent = 0;
  for (const w of selectAdminCertWarnings(rows, now)) {
    try {
      if (!(await isVerifiedAdminEmail(w.email))) continue;
      await sendAdminCertExpiryWarning(w.email, {
        daysLeft: w.daysLeft,
        validUntil: w.validUntil,
        subject: w.subject,
      });
      await db('admin_cert_fingerprints').where({ id: w.id }).update({ last_warned_at: now });
      sent++;
    } catch (err) {
      logger.error({ err, certId: w.id }, '[AdminCertMonitor] failed to warn');
    }
  }
  logger.info(`[AdminCertMonitor] Done. Warnings: ${sent}`);
  return sent;
}
