/**
 * incident-recipients.service.ts – Who gets the incident mails.
 * - Admins: every verified admin (admin_grants), as for new approval requests.
 * - Sites: per organization its SECURITY contacts; without one its DSF_ADMIN
 *   contacts; without those the organization e-mail.
 * Dependencies: db/connection, lib/adminGrants, lib/jsonColumn
 */
import { db } from '../db/connection';
import { listVerifiedAdminEmails } from '../lib/adminGrants';
import { parseJsonStringArray } from '../lib/jsonColumn';

export function adminRecipients(): Promise<string[]> {
  return listVerifiedAdminEmails();
}

interface ContactRow {
  organization_id: string;
  email: string | null;
  types: unknown;
}

/** One address list for every organization of the network, de-duplicated. */
export async function siteRecipients(): Promise<string[]> {
  const [orgs, contacts] = await Promise.all([
    db('organizations').select('identifier', 'email') as Promise<
      Array<{ identifier: string; email: string | null }>
    >,
    db('contacts').select('organization_id', 'email', 'types') as Promise<ContactRow[]>,
  ]);
  const byOrg = new Map<string, ContactRow[]>();
  for (const c of contacts) {
    const list = byOrg.get(c.organization_id) ?? [];
    list.push(c);
    byOrg.set(c.organization_id, list);
  }
  const all = new Set<string>();
  for (const org of orgs) {
    for (const email of recipientsOf(byOrg.get(org.identifier) ?? [], org.email)) all.add(email);
  }
  return [...all];
}

function recipientsOf(contacts: ContactRow[], orgEmail: string | null): string[] {
  const ofType = (type: string) =>
    contacts
      .filter((c) => c.email && parseJsonStringArray(c.types).includes(type))
      .map((c) => String(c.email).toLowerCase().trim());
  const security = ofType('SECURITY');
  if (security.length > 0) return security;
  const admins = ofType('DSF_ADMIN');
  if (admins.length > 0) return admins;
  return orgEmail ? [orgEmail.toLowerCase().trim()] : [];
}
