/**
 * ca-whitelist.service.ts – The certificate authorities DSF accepts in
 * production (migration 022 seeds the DSF 2.1.1 defaults at init).
 *
 * A site certificate counts as "issued by a DSF CA" when its issuer DN
 * matches a CLIENT entry, normalized like the blacklist (order- and
 * case-insensitive RDN comparison). The result is shown on every
 * certificate; uploads from other issuers are only rejected when
 * CA_WHITELIST_ENFORCE=true, so test and hackathon setups with self-signed
 * certificates keep working by default. Blacklisting a whitelisted CA is
 * refused (CA_WHITELISTED).
 * Dependencies: db/connection, uuid, audit.service, ca-blacklist.service (normalizeDn)
 */
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection';
import { writeAuditLog } from './audit.service';
import { normalizeDn } from './ca-blacklist.service';

export type CaWhitelistKind = 'CLIENT' | 'SERVER';

export interface CaWhitelistRow {
  id: string;
  subject_dn: string;
  fingerprint: string | null;
  kind: CaWhitelistKind;
  not_after: Date | string | null;
  source: string;
  reason: string | null;
  added_by: string;
  added_at: Date;
}

/** True when uploads from issuers outside the whitelist must be rejected. */
export function isWhitelistEnforced(): boolean {
  return process.env.CA_WHITELIST_ENFORCE === 'true';
}

export async function listWhitelist(): Promise<CaWhitelistRow[]> {
  return db<CaWhitelistRow>('ca_whitelist').orderBy([
    { column: 'kind', order: 'asc' },
    { column: 'subject_dn', order: 'asc' },
  ]);
}

/** Normalized DNs of the CLIENT entries, the CAs that issue DSF client certificates. */
async function clientIssuerDns(): Promise<Set<string>> {
  const rows: Array<{ subject_dn: string }> = await db('ca_whitelist')
    .where({ kind: 'CLIENT' })
    .select('subject_dn');
  return new Set(rows.map((r) => normalizeDn(r.subject_dn)));
}

/** Which of the given issuer DNs belong to a whitelisted CLIENT CA (one query). */
export async function whitelistedIssuers(issuerDns: string[]): Promise<Set<string>> {
  if (issuerDns.length === 0) return new Set();
  const trusted = await clientIssuerDns();
  return new Set(issuerDns.filter((dn) => trusted.has(normalizeDn(dn))));
}

export async function isIssuerWhitelisted(issuerDn: string): Promise<boolean> {
  return (await clientIssuerDns()).has(normalizeDn(issuerDn));
}

/**
 * Add a CA by subject DN (fingerprint optional, as on the blacklist).
 * @throws CONFLICT if the DN is already listed for that kind.
 */
export async function addToWhitelist(
  entry: { subjectDn: string; kind: CaWhitelistKind; fingerprint?: string; reason?: string },
  addedBy: string,
): Promise<string> {
  const existing: Array<{ subject_dn: string }> = await db('ca_whitelist')
    .where({ kind: entry.kind })
    .select('subject_dn');
  if (existing.some((r) => normalizeDn(r.subject_dn) === normalizeDn(entry.subjectDn))) {
    throw new Error('CONFLICT');
  }
  const id = uuidv4();
  await db('ca_whitelist').insert({
    id,
    subject_dn: entry.subjectDn,
    fingerprint: entry.fingerprint ? entry.fingerprint.toUpperCase() : null,
    kind: entry.kind,
    source: 'manual',
    reason: entry.reason ?? null,
    added_by: addedBy,
    added_at: new Date(),
  });
  await writeAuditLog({
    userEmail: addedBy,
    resourceType: 'CERTIFICATE',
    resourceId: id,
    operation: 'CREATE',
    diffJson: { action: 'ca_whitelist_add', subjectDn: entry.subjectDn, kind: entry.kind },
  });
  return id;
}

/** @throws NOT_FOUND */
export async function removeFromWhitelist(id: string, removedBy: string): Promise<void> {
  const row = await db('ca_whitelist').where({ id }).first();
  if (!row) throw new Error('NOT_FOUND');
  await db('ca_whitelist').where({ id }).del();
  await writeAuditLog({
    userEmail: removedBy,
    resourceType: 'CERTIFICATE',
    resourceId: id,
    operation: 'DELETE',
    diffJson: { action: 'ca_whitelist_remove', subjectDn: row.subject_dn, kind: row.kind },
  });
}
