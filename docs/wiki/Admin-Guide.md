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

### Auffälligkeits-Bewertung / request risk

Every pending request opens with a pill and one or two sentences that say how suspicious it looks.
The portal compares the request with the last approved snapshot of the same site and adds up
weighted findings. It is a review hint, not a decision: the full data stays in the expandable
snapshot.

Pills: **Unauffällig / Low risk** (green), **Prüfen / Review** (amber), **Auffällig / Suspicious**
(red), **Erstantrag / First request** (grey; shown next to the level when that is not low).

Level: HIGH if any finding is high or the score is 6 or more; MEDIUM if any finding is medium or
the score is 3 or more; otherwise LOW. A routine certificate renewal (score -1) is always LOW.

| Code | Meaning | Weight |
|------|---------|--------|
| `CERT_RENEWAL` | Certificate replaced by one with the same subject and issuer, old one expires within 60 days or is expired | -1 |
| `CERT_EARLY_REPLACE` | Certificate replaced while the old one is valid for more than 60 days | +2 |
| `CERT_ISSUER_CHANGED` | New certificate comes from a different CA than the replaced or previous ones | +2 |
| `CERT_CA_NOT_WHITELISTED` | Issuing CA of a new certificate is not on the CA whitelist | +4 |
| `CERT_CA_BLACKLISTED` | Issuing CA of a new certificate is on the CA blacklist | +6 |
| `CERT_SUBJECT_MISMATCH` | No CN/SAN name of a new certificate belongs to the organization or an endpoint domain | +2 |
| `CERT_ADDED` | More certificates than before, without a replacement | +1 |
| `CERT_ALL_REPLACED` | All previous certificates (more than one) are gone | +2 |
| `CERT_SHORT_VALIDITY` | New certificate expires within 30 days (info) | 0 |
| `ENDPOINT_ADDRESS_CHANGED` | Host of an existing endpoint changed | +2 |
| `ENDPOINT_FOREIGN_DOMAIN` | New endpoint host is on a domain that is neither the organization's nor a previously approved one | +4 |
| `ENDPOINT_ADDED` | Endpoint added | +1 |
| `ENDPOINT_REMOVED` | Endpoint removed; receivers lose it and its memberships | +2 |
| `IP_ADDED` | IP added to an existing endpoint | +1 |
| `IP_REPLACED_ALL` | None of the previously approved IPs remains | +2 |
| `IP_PRIVATE` | New IP is private (RFC1918, loopback, link-local, CGNAT, 0.0.0.0/8, IPv6 ULA / link-local / loopback) | +2 |
| `IP_SHARED` | New IP is also used by another organization | +2 |
| `ORG_NAME_CHANGED` | Organization name changed | +2 |
| `ORG_DEACTIVATED` | Organization set to inactive | +1 |
| `CONTACT_DATA_CHANGED` | Organization or contact e-mail or address changed | +2 |
| `CONTACTS_ALL_REPLACED` | No previous contact remains | +2 |
| `CONTACT_UNVALIDATED` | New DSF admin contact whose e-mail is not confirmed | +1 |
| `MEMBERSHIP_NEW_PARENT` | Joins a parent organization it was not in | +2 |
| `MEMBERSHIP_ROLE_ADDED` | Role added in an existing membership | +1 |
| `MEMBERSHIP_REMOVED` | Membership of a parent organization removed | +1 |
| `FIRST_REQUEST` | No earlier approval: everything must be reviewed; only the CA, subject, private-IP, shared-IP and foreign-domain checks run (info) | 0 |
| `RECENT_REJECTIONS` | At least one rejected request in the last 30 days | +2 |
| `RECENT_WITHDRAWALS` | Two or more withdrawn requests in the last 30 days | +1 |
| `NEW_SUBMIT_IP` | Submitted from an IP not seen before in this site's logins and submits | +1 |
| `TAKEOVER_PATTERN` | Certificate change that is not a pure renewal, together with changed contact data or a changed endpoint address or host | +4 |
| `NOTHING_CHANGED` | No difference to the last approval (info) | 0 |

Notes on how the rules are applied:

- A "domain" is compared by its last two labels (`dsf.ukm.de` is `ukm.de`); there is no public
  suffix list, so names under `co.uk`-style suffixes are judged too strictly.
- Certificates are matched by thumbprint. A replaced certificate whose database row is gone is
  judged by the subject and expiry stored in the snapshot; its issuer cannot be compared.
- `CONTACT_DATA_CHANGED` needs the editable-fields digest in both snapshots.
- Unreadable or missing data never blocks the list: the risk is simply computed from what exists.

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

NIS2 deadlines follow § 32 BSIG. The time the site **became aware** of the
incident ("Kenntnis erlangt am") starts them: early warning after 24 h,
notification after 72 h. The final report is due **one calendar month after
the notification**, counted from the moment the notification was ticked as
reported; until then the date is a forecast from the 72 h deadline and shown
as "provisional". The awareness time can be corrected by an admin (with the
step-up, like the Zulip link; it may lie at most one year back). Two more
stages exist: the **interim report** (Zwischenmeldung) is due only when the
BSI asks for it, so an admin or the site records the date of the request
first and can then tick it; the **progress report** (Fortschrittsmeldung)
appears when the final report falls due while the incident is still open. It
is ticked instead, and the final report is then due one month after the
incident is closed. A closed incident still takes its final report.

For every stage the portal keeps the details as a **filling aid for the BSI
form**: early warning (suspected unlawful or malicious acts, possible
cross-border impact, affected services), notification (severity, impact,
optional indicators of compromise) and final or progress report (type of
threat or root cause, applied and ongoing mitigation, cross-border impact;
one set for both). Admins, the reporter and users of the affected site see and
edit them; other sites never do. A stage can be ticked as "reported to BSI"
only when its required details are saved, and the details of a ticked stage
are locked as a record. Saving details and ticks are events in the timeline
(field names only, never the texts) and audit entries; the details are part of
the hash chain. Users of the affected site and admins also tick "data
protection officer informed". The portal never reports to the BSI itself;
that duty stays with the site. The incident export (JSON or CSV) lists the
stages in the order of § 32 with due date and details.

Every change is an event in an append-only timeline, chained with SHA-256.
The chain also covers title, description, site, awareness time and the NIS2 report details, and the
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
