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
  IMI_ADMIN_EMAILS=admin1@example.org,admin2@example.org
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
| Admin Certificates | `/app/admin/certificates` | Client certificates of admins: add, label, remove, request one for a colleague |
| CA Lists | `/app/admin/ca-blacklist` | CA blacklist (distrusted issuers) and CA whitelist (CAs the DSF accepts) |
| Bundle Versions | `/app/admin/bundle-versions` | Allow-list history, diff, download, four-eyes restore |
| Onboarding | `/app/admin/onboarding` | Bulk import of sites from CSV/XLSX |
| Backups | `/app/admin/backups` | Backup schedule, runs, download |
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

Each certificate in the snapshot shows two badges: **In allow list** / **Not published** and
**Login** / **No login**. The site sets both per certificate before submitting. Only published
thumbprints reach the allow list, only login certificates may sign in once the request is approved
(a login-only certificate never appears in a bundle, a published-only one never logs in). Older
snapshots without the flags count as both set. At least one certificate must be published.

### Request risk assessment

Every pending request opens with a pill and one or two sentences that say how suspicious it looks.
The portal compares the request with the last approved snapshot of the same site and adds up
weighted findings. It is a review hint, not a decision: the full data stays in the expandable
snapshot.

Pills: **Unauffällig / Low risk** (green), **Prüfen / Review** (amber), **Auffällig / Suspicious**
(red), **Erstantrag / First request** (grey; shown next to the level when that is not low).

Level: HIGH if any finding is high or the positive weights add up to 6 or more; MEDIUM if any finding
is medium or they add up to 3 or more; otherwise LOW. A routine certificate renewal (-1) is the only
mitigating finding: it never lowers the level, and it counts as 0 as soon as the request also has a
medium or high finding or comes from a new IP address.

| Code | Meaning | Weight |
|------|---------|--------|
| `CERT_RENEWAL` | Certificate replaced by one with the same subject and issuer, old one expires within 60 days or is expired | -1 |
| `CERT_EARLY_REPLACE` | Certificate replaced while the old one is valid for more than 60 days | +2 |
| `CERT_ISSUER_CHANGED` | New certificate comes from a different CA than the replaced or previous ones | +2 |
| `CERT_SUBJECT_CHANGED` | A certificate was replaced by one with a different subject | +2 |
| `CERT_NOT_COMPARABLE` | Issuer or old expiry of a replaced certificate is unknown (snapshot from before issuer facts were stored, row deleted): never rated a renewal | +1 |
| `CERT_CA_NOT_WHITELISTED` | Issuing CA of a new certificate is not on the CA whitelist | +4 |
| `CERT_CA_BLACKLISTED` | Issuing CA of a new certificate is on the CA blacklist | +6 |
| `CERT_SUBJECT_MISMATCH` | No CN/SAN name of a new certificate belongs to the organization or an endpoint domain | +2 |
| `CERT_ADDED` | More certificates than before, without a replacement | +1 |
| `CERT_ALL_REPLACED` | All previous certificates (more than one) are gone and not all were routine renewals | +2 |
| `CERT_EXPIRED` | A new certificate is already expired | +2 |
| `CERT_SHORT_VALIDITY` | A new certificate expires within 30 days | +1 |
| `CERT_LOGIN_ONLY` | A certificate is used for login only (not published) and is new or was published before | +2 |
| `CERT_UNPUBLISHED` | A previously published certificate is no longer published (and not login-only) | +1 |
| `CERT_NO_LOGIN` | The site has certificates but none is marked for login, and it has no onboarding, admin or migrated login entry: after approval it could not sign in by certificate | +2 |
| `ENDPOINT_ADDRESS_CHANGED` | Host of an existing endpoint changed | +2 |
| `ENDPOINT_SCHEME_DOWNGRADE` | Endpoint address changed from https to http | +2 |
| `ENDPOINT_URL_CHANGED` | Port or path of an endpoint address changed (same host) | +1 |
| `ENDPOINT_ADDRESS_UNREADABLE` | A new or changed endpoint address is not a readable http(s) URL | +2 |
| `ENDPOINT_FOREIGN_DOMAIN` | New endpoint host is on a domain that is neither the organization's nor a previously approved one | +4 |
| `ENDPOINT_ADDED` | Endpoint added | +1 |
| `ENDPOINT_REMOVED` | Endpoint removed; receivers lose it and its memberships | +2 |
| `IP_ADDED` | IP added to an existing endpoint (also when it had none) | +1 |
| `IP_REPLACED_ALL` | None of the previously approved IPs remains | +2 |
| `IP_PRIVATE` | New IP is private or special-purpose (RFC1918, loopback, link-local, CGNAT, 0.0.0.0/8, documentation and benchmarking ranges, multicast, reserved, IPv6 ULA / link-local / site-local, IPv4-mapped and NAT64 forms of those) | +2 |
| `IP_SHARED` | New IPs are also used by other organizations (one finding, with the count and up to three organizations) | +2 |
| `ORG_NAME_CHANGED` | Organization name changed | +2 |
| `ORG_DEACTIVATED` | Organization set to inactive | +1 |
| `CONTACT_DATA_CHANGED` | Organization or contact e-mail or address changed | +2 |
| `CONTACT_DATA_NOT_COMPARABLE` | One snapshot has no editable-fields digest, so contact data could not be compared (info) | 0 |
| `CONTACTS_ALL_REPLACED` | No previous contact remains | +2 |
| `CONTACT_UNVALIDATED` | New DSF admin contact whose e-mail is not confirmed | +1 |
| `CONTACT_ROLE_CHANGED` | An existing contact became DSF admin | +1 |
| `MEMBERSHIP_NEW_PARENT` | Joins a parent organization it was not in (parents compared case-insensitively) | +2 |
| `MEMBERSHIP_ROLE_ADDED` | Role added in an existing membership | +1 |
| `MEMBERSHIP_REMOVED` | Membership of a parent organization removed | +1 |
| `FIRST_REQUEST` | No earlier approval: everything must be reviewed; only the CA, subject, expiry, private-IP, shared-IP and foreign-domain checks run (info) | 0 |
| `RECENT_REJECTIONS` | At least one rejected request in the last 30 days | +1 |
| `RECENT_WITHDRAWALS` | Two or more withdrawn requests in the last 30 days | +1 |
| `NEW_SUBMIT_IP` | Submitted from an IP not seen in this site's logins and submits up to the previous approval | +1 |
| `TAKEOVER_PATTERN` | A certificate change that is not a routine renewal together with changed contact data, all contacts replaced, or a changed endpoint address or host; or the same certificate change (or a renewal from a new IP) within 30 days after an approved request that changed the contact data or an endpoint address | +4 |
| `SNAPSHOT_UNREADABLE` | The request snapshot is empty or unreadable; it is the only finding | +4 |
| `NOTHING_CHANGED` | No difference to the last approval (info) | 0 |

Notes on how the rules are applied:

- A "domain" is compared by its registrable domain: the last two labels (`dsf.ukm.de` is `ukm.de`),
  three under a built-in list of common second-level suffixes (`ac.uk`, `co.uk`, `gv.at`, `com.au`,
  ...). There is no full public-suffix list, so rare suffixes are judged as two labels.
- Certificates are matched by thumbprint. The snapshot stores each certificate's
  issuer DN, subject DN, DNS names and expiry (never the PEM), so a renewal that deleted the old
  certificate row can still be compared. Replacements are paired by subject first, whatever the order
  in the snapshot. A previous snapshot without these facts or without thumbprints is not comparable.
- Endpoint addresses are compared normalised (case, trailing dot and slash ignored).
- IPs are compared in canonical form (IPv6 compressed, IPv4-mapped written as IPv4).
- "Known" submit IPs are logins and submits of the site up to the moment the previous request was
  approved (without a previous approval: up to 24 hours before the submit), so a login right before
  submitting never makes a new address look familiar.
- `CONTACT_DATA_CHANGED` needs the editable-fields digest in both snapshots.
- The text under the pill shows at most the five most severe findings, then "+n more"; names taken
  from the site's data are shortened to 40 characters and stripped of control characters.

## Removing a Site

A site that left the network is removed on the **Approval Review** page
(section "Remove a site"). Two admins with different e-mail domains are needed,
the same rule as for an approval:

1. Admin A picks the site, writes a reason and requests the removal (step-up).
   A can cancel while the request is open; nobody can confirm their own request.
2. Admin B (other domain) confirms (step-up). The removal runs at once.

What happens: the organization counts as withdrawn, so a new allow-list version
(MANUAL, created automatically) deletes its Organization, Endpoints and
affiliations on every DSF server. Its login certificates are removed, its
sessions end, it can no longer log in and it disappears from the owner's
instance list. A pending approval request of the site is withdrawn. If creating
the version fails, the removal still stands and the toast says so; create a
version on the Bundle Versions page. Nothing is deleted from the database
(soft removal); hard deletion is not part of the portal. Request, confirm and
cancel are audited (`AUTH`, `diff_json.action` `instance_removal_*`).

**Removal is permanent for now.** There is no route or button to undo it, the
organization and endpoint identifiers stay occupied (nobody can register them
again) and the removed site's data stays in the database. If a site was removed
by mistake, an operator has to undo it by hand in the database:

```sql
UPDATE instances SET removed_at = NULL, removed_by = NULL WHERE id = '<instance-id>';
```

Then the site submits a new approval request and two admins approve it: the next
allow-list version publishes the site again and the approval restores its
approval-based login certificates. The login certificates that were removed
with the site (including onboarding and admin-added ones) are not brought back;
add them again on the site's certificate page or in the Admin area.

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

   **Lifting the certificate blocks of a false alarm.** The blocks of the
   thumbprints stay after a suspension is lifted. If the incident ends as
   FALSE_ALARM, two admins of different e-mail domains can lift them (panel
   "Zertifikatssperren" on the incident): admin A requests with a reason, admin
   B confirms, A may cancel while it is open, nobody confirms their own request.
   The block rows stay in the database; an append-only lift record per
   thumbprint names both admins and the reason, and a block counts only while
   no lift exists. Login, the allow list, the login sync and the upload and
   admin-certificate checks follow at once. A confirmed lift restores the
   site's approval-based logins (unless the site was removed or another
   incident still suspends it) and publishes a new allow-list version. A
   later incident can block the same thumbprint again.

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

- **Audit Log** — `/app/audit` shows all changes with filters and export.
- **Activity feed** — the "Recent activity" button in the footer of the canvas lists recent changes.
