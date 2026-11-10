# Admin Guide

## Becoming an Admin

Admin status is recorded in the `admin_grants` table, where each row is signed
(RS256) so a database-only attacker cannot grant themselves admin. There are two
ways a row gets there:

- **Bootstrap (first run only):** on the first backend start, emails listed in
  `IMI_ADMIN_EMAILS` are turned into signed grants. After that first run the env
  var is ignored — the table is authoritative. Remove it from production once the
  initial admins exist.

  ```
  IMI_ADMIN_EMAILS=admin1@example.com,admin2@example.com
  ```

- **Ongoing (4-eyes promotion):** an existing admin requests a promotion for a
  target user at `/app/admin/promotions`; a **second** admin from a different
  site must approve it (no silent consent). See ADR-001 (cryptographic admin
  grants) and ADR-003 (four-eyes approval).

## Administration pages

Admin-only pages are grouped under the collapsible **Administration** section in
the left sidebar (closed by default; all require admin + a TOTP step-up on
writes):

| Page | Path | Purpose |
|---|---|---|
| Approval Review | `/app/admin` | Action pending approval requests |
| User Management | `/app/admin/users` | Whitelist + lock/unlock/demote/remove |
| Promotions | `/app/admin/promotions` | Approve/reject admin-promotion requests |
| CA Blacklist | `/app/admin/ca-blacklist` | Distrusted CA issuer DNs/fingerprints |
| Bundle Versions | `/app/admin/bundle-versions` | Federation bundle history, diff, download |
| Incidents | `/app/admin/incidents` | Security incidents: confirm, suspend a site, close |
| Audit Log | `/app/audit` | Append-only operations history |

## Approval Workflow

1. A site admin submits changes via "Send for Approval"
2. All IMI admins receive an email notification immediately
3. Open the **Approval Review** page (`/app/admin`)
4. Expand a pending request to see the full data snapshot
5. Enter your 6-digit authenticator code
6. Click **Approve** or **Reject** (rejection requires a comment)
7. Admins are notified immediately of the decision
8. Site contacts receive notification after 30 minutes (gives time to reverse)

## Email Whitelist

Manage who can log in:

```bash
# Add a user (seed script)
docker compose exec backend npx ts-node src/db/seed-whitelist.ts user@example.com

# Or via the Admin API (admin + TOTP)
POST   /api/v1/admin/users            { email, totpCode }   # add to whitelist
POST   /api/v1/admin/users/:email/lock    { reason, totpCode }
POST   /api/v1/admin/users/:email/unlock  { totpCode }
POST   /api/v1/admin/users/:email/demote  { totpCode }
DELETE /api/v1/admin/users/:email         { totpCode }       # remove from whitelist
```

## Security Incidents

The incident register (`/app/admin/incidents`) is the one place where a
compromised site is reported, acted on and recorded. One admin can act alone.
Sensitive actions only need the usual step-up (authenticator code, or the
client certificate in a certificate session). There is no four-eyes step and
no waiting period.

1. **Report.** Any signed-in user reports an incident with the affected site
   (it can be unknown), a short title, the description and the escalation
   level (1 operation continues, 2 pause, 3 shutdown). An admin can enter one
   directly, for example after a phone call. Every admin gets a mail at once.
   Until it is confirmed, only admins and the reporter see the incident.
2. **Confirm.** The incident becomes visible to every signed-in user, and all
   sites are mailed. Site mails go to the SECURITY contacts, falling back to
   the DSF_ADMIN contacts and then the organization e-mail.
3. **Suspend the site** ("Standort sperren"). This can be done together with
   confirming. The measures are on by default:
   - block every certificate and login thumbprint of the site for good,
     including those its approved and pending requests still list (admin
     certificates are never blocked by a site incident),
   - remove its login certificates and end every session of its organization
     certificate scope (also when an admin owns the instance; a non-admin
     owner loses all sessions),
   - publish the site as withdrawn, whatever its approved snapshot says,
   - mail all sites (the mail announces a suspension only when the site was
     withdrawn).

   Blocking or withdrawing publishes one new allow-list version right away;
   if publishing fails nothing is marked as suspended and you can retry
   (withdrawing an already suspended site publishes again). The IP address
   list and the network map leave a withdrawn site out as well. Each measure
   and its result goes into the timeline.

   The owner of a suspended site can still sign in with the e-mail code
   (OTP) and use the portal. That is on purpose: the site needs it to upload
   a new certificate and submit it for approval. Its certificate logins and
   its DSF stay locked out by the blocked thumbprints.
4. **Comment.** Use comments for measures taken outside the portal. Every
   user who can see the incident can read them.
5. **Lift the suspension.** You must confirm the restart checklist (cause
   fixed, fix proven by tests, release by the DSF Technikgremium) and add a
   note. The old thumbprints stay blocked. The site comes back only with a new
   certificate, which goes through the normal four-eyes approval.
6. **Close.** Close as CLOSED with the post-incident review and the measures
   derived from it, or as FALSE_ALARM with the reason. Lift any suspension
   first. Incidents are never deleted.

NIS2 deadlines (early warning after 24 h, notification after 72 h, final
report after one month) count from the detection time, which an admin can
correct (with the step-up, like the Zulip link; it may lie at most one year
back). Users of the affected site and admins tick "reported to BSI" per
stage and "data protection officer informed". The portal never reports to the
BSI itself; that duty stays with the site.

Every change is an event in an append-only timeline, chained with SHA-256.
The chain also covers title, description, site and detection time, and the
chain head is stored with each audit entry. The detail view shows whether the
chain verifies. Incident audit entries are not attached to the affected
site's instance, so the site's own audit log does not show them. For authority requests,
download one incident as JSON or CSV (`GET /api/v1/admin/incidents/:id/export`).
The download includes the full timeline and the hash values. Mails never
contain the description.

## Certificate Renewal

When a certificate is expiring:
1. The site admin sees a warning banner and expiry timeline
2. Click "Renew" on the Certificates card
3. Select the expiring certificate
4. Upload or drag-drop the new PEM file
5. Review the comparison and confirm
6. Submit for approval to apply changes

## Monitoring

- **Audit Log** — `/app/audit` shows all changes with filters
- **Status Dashboard** — `/app/status` shows entity counts and expiry warnings
- **Activity Feed** — floating button shows recent changes in real-time
