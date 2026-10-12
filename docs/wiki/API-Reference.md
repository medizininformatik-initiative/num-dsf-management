# API Reference

This document enumerates every HTTP endpoint exposed by the backend (`backend/src/routes/*.ts`), mounted as configured in `backend/src/app.ts`.

All successful JSON responses use the envelope `{ data, error, meta }` (`error` is `null` on success, `meta` is present only where noted). Error responses are `{ error: { code, message, details? } }`. Validation failures return `400` with `code: "VALIDATION"`; unknown routes return `404` with `code: "NOT_FOUND"`.

## Auth column legend

| Marker | Meaning |
|--------|---------|
| public | No middleware; open endpoint (OTP-rate-limited where noted) |
| requireAuth | Valid JWT Bearer access token |
| requireAdmin | `requireAuth` + `requireImiAdmin` (IMI operator) |
| requireOwner | `requireAuth` + `requireInstanceOwnership` (caller owns `:instanceId`, or is admin) |
| requireTotp | A valid live TOTP code in the body (in addition to the JWT) |
| mTLS | Client-certificate thumbprint match (no JWT) |

---

## Auth

Mounted at `/auth`. All endpoints are `public` and Redis-rate-limited (5 req / 15 min per IP), except where the limiter is skipped in test/dev.

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | /auth/request-otp | public | Send a 6-digit OTP by email if the address is whitelisted. Always 200 (no enumeration). |
| POST | /auth/verify-otp | public | Verify OTP, return a short-lived `tempToken`. |
| POST | /auth/setup-totp | public | First login: return TOTP QR code. Refuses (409) if TOTP already enabled. |
| POST | /auth/confirm-totp | public | Confirm TOTP after setup, create session, return access token + backup codes. |
| POST | /auth/verify-totp | public | Verify TOTP on subsequent logins, create session. |
| POST | /auth/refresh | public | Exchange refresh-token cookie for a new access token. |
| POST | /auth/client-cert-login | mTLS | Authenticate by registered client-certificate thumbprint, create session. |
| POST | /auth/logout | public | Revoke refresh token (Redis) and clear cookie. |
| POST | /auth/dev-login | public | Dev/CI only — registered solely when `NODE_ENV != production` and `DEV_AUTO_LOGIN=true`; otherwise 404. |
| GET | /auth/me | requireAuth | Return `{ email, isAdmin }` of the current user. |

Notes:
- `request-otp` body `{ email }`; `verify-otp` body `{ email, code }` → `{ tempToken }`.
- `setup-totp` body `{ tempToken }` → `{ qrCodeUrl }` (secret is never returned).
- `confirm-totp` / `verify-totp` body `{ tempToken, code }` → `{ accessToken, backupCodes? }`; refresh token set as httpOnly cookie scoped to `/auth`.
- `refresh` reads the `refreshToken` cookie → `{ accessToken }`.

---

## Instances

Mounted at `/api/v1/instances`. All endpoints `requireAuth`.

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | /api/v1/instances | requireAuth | List instances owned by the user (admins see all). |
| POST | /api/v1/instances | requireAuth | Create a new instance (201). |
| GET | /api/v1/instances/:id | requireAuth | Fetch a single instance (404 if not visible). |
| PUT | /api/v1/instances/:id/label | requireAuth | Rename instance. Body `{ label }` (1–255 chars); 403 if not owner. |

---

## Organization

Mounted at `/api/v1/instances/:instanceId/organization`. All endpoints `requireOwner`.

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | /api/v1/instances/:instanceId/organization | requireOwner | Get the organization for the instance. |
| PUT | /api/v1/instances/:instanceId/organization | requireOwner | Upsert the organization. |
| POST | /api/v1/instances/:instanceId/organization/request-removal | requireOwner | Submit a removal approval request. |

PUT body (`upsertOrganizationSchema`): `{ identifier (FQDN), name, email, active?, addressLine?, postalCode?, city?, countryCode?, clientCertThumbprint?, totpCode? }`. Changing `clientCertThumbprint` on your own org requires a 6-digit `totpCode` (else `TOTP_REQUIRED`/`TOTP_INVALID`). An admin editing another user's org cannot modify the thumbprint (`FORBIDDEN_THUMBPRINT_WRITE`).

---

## Contacts

Mounted at `/api/v1/instances/:instanceId/contacts`. All endpoints `requireOwner`.

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | /api/v1/instances/:instanceId/contacts | requireOwner | List contacts. |
| POST | /api/v1/instances/:instanceId/contacts | requireOwner | Create a contact (201). |
| PUT | /api/v1/instances/:instanceId/contacts/:cid | requireOwner | Update a contact. |
| DELETE | /api/v1/instances/:instanceId/contacts/:cid | requireOwner | Delete a contact → `{ deleted: true }`. |
| POST | /api/v1/instances/:instanceId/contacts/:cid/resend-verification | requireOwner | Re-send the email-verification message. |

Create/update body (`createContactSchema`): `{ types: ["MEDIC"|"DSF_ADMIN"|"SECURITY"] (≥1), email, name?, phone?, addressLine?, city?, postalCode?, countryCode? }`.

---

## Endpoints

Mounted at `/api/v1/instances/:instanceId/endpoints`. All endpoints `requireOwner`.

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | /api/v1/instances/:instanceId/endpoints | requireOwner | List endpoints. |
| POST | /api/v1/instances/:instanceId/endpoints | requireOwner | Create an endpoint (201). |
| PUT | /api/v1/instances/:instanceId/endpoints/:eid | requireOwner | Update an endpoint. |
| DELETE | /api/v1/instances/:instanceId/endpoints/:eid | requireOwner | Delete an endpoint → `{ deleted: true }`. |

Create body (`createEndpointSchema`): `{ identifier, address (URL), name?, ipAddresses?: [{ ip (IPv4), isFhir?, isBpe? }] }`. Update body is the same fields, all optional.

---

## Certificates

Mounted at `/api/v1/instances/:instanceId/certificates`. All endpoints `requireOwner`.

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | /api/v1/instances/:instanceId/certificates | requireOwner | List certificates. |
| GET | /api/v1/instances/:instanceId/certificates/expiring | requireOwner | Certificates expiring within 90 days. |
| POST | /api/v1/instances/:instanceId/certificates | requireOwner | Upload a PEM certificate (201). |
| DELETE | /api/v1/instances/:instanceId/certificates/:cid | requireOwner | Delete a certificate → `{ deleted: true }`. |
| POST | /api/v1/instances/:instanceId/certificates/:cid/renew | requireOwner | Replace/renew a certificate's PEM. |

POST body (`createCertificateSchema`): `{ pem }` — must contain `-----BEGIN CERTIFICATE-----`. PEM containing private-key material is rejected with `400 PRIVATE_KEY_REJECTED`; PEM content is never logged.

---

## Memberships

Mounted at `/api/v1/instances/:instanceId/memberships`. All endpoints `requireOwner`.

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | /api/v1/instances/:instanceId/memberships | requireOwner | List memberships. |
| POST | /api/v1/instances/:instanceId/memberships | requireOwner | Create a membership (201). |
| PUT | /api/v1/instances/:instanceId/memberships/:mid | requireOwner | Update a membership. |
| DELETE | /api/v1/instances/:instanceId/memberships/:mid | requireOwner | Soft-delete a membership → `{ deleted: true }`. |

Create body (`createMembershipSchema`): `{ parentOrganization, endpointId, roles: ["DIC"|"HRP"|"DMS"|"AMS"] (≥1) }`. Update fields all optional.

---

## Approval (tenant side)

Mounted at `/api/v1/instances/:instanceId/approval`. All endpoints `requireOwner`.

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | /api/v1/instances/:instanceId/approval/submit | requireOwner | Submit the instance for approval. |
| POST | /api/v1/instances/:instanceId/approval/withdraw | requireOwner | Withdraw the PENDING request (status `WITHDRAWN`, audit `WITHDRAW`). `409 NOT_PENDING` when no request is pending or an admin decision won the race. Partial four-eyes approvals on it never count later. |
| GET | /api/v1/instances/:instanceId/approval/status | requireOwner | Current approval status. |
| GET | /api/v1/instances/:instanceId/approval/history | requireOwner | Approval-request history. |

---

## Admin

### Approval

Mounted at `/api/v1/admin/approval`.

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | /api/v1/admin/approval/pending | requireAdmin | List pending requests, enriched with collected signatures. |
| POST | /api/v1/admin/approval/:rid/approve | requireAdmin + requireTotp | Approve a request (4-eyes; same-site/double-decision guarded). Body `{ totpCode }`. |
| POST | /api/v1/admin/approval/:rid/reject | requireAdmin + requireTotp | Reject a request. Body `{ totpCode, comment? }`. |

### Users (whitelist)

Mounted at `/api/v1/admin/users`. All `requireAdmin`; writes also `requireTotp`.

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | /api/v1/admin/users | requireAdmin | List whitelist entries + admin grants. |
| POST | /api/v1/admin/users | requireAdmin + requireTotp | Add an email to the whitelist. Body `{ email, totpCode }` (201). |
| POST | /api/v1/admin/users/:email/lock | requireAdmin + requireTotp | Lock an account. Body `{ reason?, totpCode }`. |
| POST | /api/v1/admin/users/:email/unlock | requireAdmin + requireTotp | Unlock an account. Body `{ totpCode }`. |
| POST | /api/v1/admin/users/:email/demote | requireAdmin + requireTotp | Remove admin grant. Body `{ totpCode }`. |
| DELETE | /api/v1/admin/users/:email | requireAdmin + requireTotp | Remove from whitelist. Body `{ totpCode }`. |

### Promotions (4-eyes admin grants)

Mounted at `/api/v1/admin/promotions`. All `requireAdmin`; writes also `requireTotp`.

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | /api/v1/admin/promotions | requireAdmin | List pending promotion requests. |
| POST | /api/v1/admin/promotions | requireAdmin + requireTotp | Create a promotion request. Body `{ targetEmail, totpCode }` (201). |
| POST | /api/v1/admin/promotions/:id/approve | requireAdmin + requireTotp | Approve (must be a different admin from a different site). Body `{ totpCode }`. |
| POST | /api/v1/admin/promotions/:id/reject | requireAdmin + requireTotp | Reject. Body `{ reason?, totpCode }`. |
| POST | /api/v1/admin/promotions/:id/cancel | requireAdmin + requireTotp | Cancel a pending request. Body `{ totpCode }`. |

### CA Blacklist

Mounted at `/api/v1/admin/ca-blacklist`. All `requireAdmin`.

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | /api/v1/admin/ca-blacklist | requireAdmin | Return `{ blacklist, knownCas }` (known CAs = Mozilla cache picker). |
| POST | /api/v1/admin/ca-blacklist | requireAdmin | Add an entry. Body `{ subjectDn, fingerprint? (64-hex), reason? }` → `{ id }` (201). |
| DELETE | /api/v1/admin/ca-blacklist/:id | requireAdmin | Remove an entry → `{ deleted: true }`. |

### CA Whitelist

Mounted at `/api/v1/admin/ca-whitelist`. All `requireAdmin`; writes need the step-up (TOTP code, or the re-presented client certificate in certificate sessions).

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | /api/v1/admin/ca-whitelist | requireAdmin | Return `{ whitelist, enforced }`; `enforced` mirrors `CA_WHITELIST_ENFORCE`. |
| POST | /api/v1/admin/ca-whitelist | requireAdmin + step-up | Add an entry. Body `{ subjectDn, kind? (CLIENT, SERVER), fingerprint? (64-hex), reason?, totpCode? }` → `{ id }` (201, 409 if listed). |
| DELETE | /api/v1/admin/ca-whitelist/:id | requireAdmin + step-up | Remove an entry → `{ deleted: true }` (404 if unknown). |

Adding a whitelisted CA to the blacklist returns `409 CA_WHITELISTED`. Certificates returned by `/api/v1/instances/:id/certificates` carry `issuerDn` and `issuerTrusted`.

### Login Certificates

Mounted at `/api/v1/admin/organizations`. All `requireAdmin`; writes need the step-up (TOTP code, or the re-presented client certificate in certificate sessions). Every change is audited as `ORGANIZATION`/`UPDATE` with `diff_json.action = 'login_certificate'`. A login through an enabled certificate yields a session scoped to that organization's instance (never admin).

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | /api/v1/admin/organizations/:identifier/login-certificates | requireAdmin | Login certificates of the organization: `[{ fingerprint, certificateId, source, createdBy, createdAt, uploadedByClinic }]`. |
| POST | /api/v1/admin/organizations/:identifier/login-certificates | requireAdmin + step-up | Enable an uploaded certificate of the organization as login certificate. Body `{ certificateId, totpCode? }` (SHA-512 computed server-side) → 201. `409 NOT_CLINIC_UPLOADED` unless the clinic itself uploaded the certificate (an admin upload or unknown origin never qualifies), `409 ADMIN_CERTIFICATE` for an admin certificate, `409 FINGERPRINT_IN_USE` if another organization uses it, `404` for an unknown organization or certificate. |
| DELETE | /api/v1/admin/organizations/:identifier/login-certificates/:fingerprint | requireAdmin + step-up | Remove a login entry (also fingerprint-only entries from onboarding) → `{ deleted: true }`. |
| POST | /api/v1/admin/users/:email/certificates | requireAdmin + step-up | Four-eyes: REQUEST an admin certificate for a colleague. Body `{ pem, label?, totpCode? }` → 201 `{ id, status: "PENDING" }`; nothing becomes active. Same validation as an upload plus `409 REQUEST_ALREADY_PENDING`. |
| GET | /api/v1/admin/admin-cert-requests | requireAdmin | Pending and recently decided certificate requests (never the PEM). |
| POST | /api/v1/admin/admin-cert-requests/:id/approve | requireAdmin + step-up | Third admin from a different site than the requester activates the certificate. `403 SELF_APPROVE` / `TARGET_APPROVE` / `SAME_SITE`, `409 NOT_PENDING` (first decision wins), validation errors if the certificate went stale. |
| POST | /api/v1/admin/admin-cert-requests/:id/reject | requireAdmin + step-up | Body `{ comment, totpCode? }`. |
| POST | /api/v1/admin/admin-cert-requests/:id/cancel | requireAdmin + step-up | Requester withdraws the request. Pending requests expire after 7 days. |
| GET | /api/v1/instances/:id/certificates/login-certificates | requireAuth + instance | Read-only view of the same list for the instance's users (badges in the certificates card). |

### Bundle Versions

Mounted at `/api/v1/admin/bundle-versions`. All `requireAdmin`.

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | /api/v1/admin/bundle-versions | requireAdmin | Paginated bundle history (`?page=&limit=`); includes `meta` pagination. Rows carry `isCurrent` (the version the allow list is published from) and `restorable` (has a stored input). |
| GET | /api/v1/admin/bundle-versions/:id | requireAdmin | Single version + parsed bundle (+ `restorable`). |
| POST | /api/v1/admin/bundle-versions/:id/restore | requireAdmin + step-up | Request that an old version is published again (four-eyes, nothing is published yet). Body `{ reason (3-500), totpCode? }` → `{ id, sourceVersionNumber }` (201), a `PENDING` restore request. 404 unknown id, 409 `VERSION_NOT_RESTORABLE` (version without stored input), 409 `ALREADY_PENDING` (only one pending request at a time), 400 invalid reason. |
| GET | /api/v1/admin/bundle-versions/:id/download | requireAdmin | Raw bundle JSON as attachment (signature + content-hash headers). |
| GET | /api/v1/admin/bundle-versions/:idA/diff/:idB | requireAdmin | Diff between two versions. |

### Bundle Restores (four-eyes)

Mounted at `/api/v1/admin/bundle-restores`. All `requireAdmin`; the writes need the step-up (TOTP code, or the re-presented client certificate in certificate mode). Same rules as admin promotions: no self-approval, the approver is from a different site (email domain) than the requester, the first decision is final.

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | /api/v1/admin/bundle-restores | requireAdmin | Restore requests, newest first (`id`, `sourceVersionId`, `sourceVersionNumber`, `reason`, `requestedBy`, `requestedAt`, `status` PENDING/APPROVED/REJECTED/CANCELLED, `decidedBy`, `decidedAt`, `decisionComment`, `resultingVersionId`, `resultingVersionNumber`). |
| POST | /api/v1/admin/bundle-restores/:rid/approve | requireAdmin + step-up | Second admin of another site approves: the old version is published again as a new version (`triggered_by` RESTORE, `triggered_by_email` the approver) → `{ id, versionNumber, restoredFromVersion }`. 403 `SELF_APPROVE` / `SAME_SITE`, 404 unknown request, 409 `NOT_PENDING` (already decided) or `VERSION_NOT_RESTORABLE` (checked again; the request stays pending). |
| POST | /api/v1/admin/bundle-restores/:rid/reject | requireAdmin + step-up | Body `{ comment (3-500) }`. Closes the request, nothing is published. 409 `NOT_PENDING`. |
| POST | /api/v1/admin/bundle-restores/:rid/cancel | requireAdmin + step-up | The requester withdraws a pending request. 403 `NOT_REQUESTER`, 409 `NOT_PENDING`. |

Every step (request, approve, reject, cancel) is written to the audit log (`resource_type` APPROVAL, `diff_json.action` `bundle_restore`).

### Backups (admin)

Mounted at `/api/v1/admin/backups`. All `requireAdmin`; writes and the download need the step-up (TOTP code, or the re-presented client certificate in certificate sessions). Restoring is not an API: it is done by hand on the server (`scripts/restore-backup.sh`, see DEPLOYMENT.md, "Backup und Wiederherstellung").

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | /api/v1/admin/backups/settings | requireAdmin | `{ settings: { enabled, mode (EVERY_6H, EVERY_12H, DAILY), dailyTime (HH:MM, Europe/Berlin), retentionCount, updatedBy, updatedAt }, encryptionEnabled, directory }`. |
| PUT | /api/v1/admin/backups/settings | requireAdmin + step-up | Body `{ enabled, mode, dailyTime, retentionCount (7-365), totpCode? }` → `{ settings }`. 400 `VALIDATION`. Audited (`BACKUP` / `UPDATE`). |
| GET | /api/v1/admin/backups/runs | requireAdmin | `{ runs }`, newest first: `id`, `startedAt`, `finishedAt`, `trigger` SCHEDULED/MANUAL, `triggeredBy`, `status` SUCCESS/FAILED, `fileName`, `sizeBytes`, `sha256` (of the file), `encrypted`, `durationMs`, `error`, `fileDeleted`. |
| POST | /api/v1/admin/backups/run | requireAdmin + step-up | Create a backup now → `{ run }` (201). 409 `BACKUP_BUSY` (another run holds the lock), 500 `BACKUP_FAILED` (the failed run is recorded). |
| POST | /api/v1/admin/backups/runs/:id/download | requireAdmin + step-up + rate limit (10 / 15 min) | Streams the stored file (`application/octet-stream`, attachment). POST rather than GET so the OTP step-up code can travel in the body. 404 if unknown, pruned or not a managed file name. Audited (`BACKUP` / `DOWNLOAD`). |

### Approval / Audit / Instances (admin.routes)

Mounted at `/api/v1/admin`. All `requireAdmin`.

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | /api/v1/admin/instances | requireAdmin | List all instances (cross-tenant). |
| GET | /api/v1/admin/audit | requireAdmin | Paginated cross-instance audit log (`?page=&limit=`); includes `meta` pagination. |

### Marketplace (admin writes)

Mounted at `/api/v1/admin/marketplace`. All `requireAdmin`; writes also `requireTotp`.

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | /api/v1/admin/marketplace | requireAdmin + requireTotp | Add an entry. Body `{ gitUrl, status?, totpCode }` (201, 409 on duplicate). |
| PATCH | /api/v1/admin/marketplace/:id | requireAdmin + requireTotp | Update status. Body `{ status, totpCode }`. |
| DELETE | /api/v1/admin/marketplace/:id | requireAdmin + requireTotp | Remove an entry. Body `{ totpCode }` → `{ deleted: true }`. |

`gitUrl` must be `https://github.com/owner/repo`; `status` ∈ `APPROVED|EXPERIMENTAL|DEPRECATED`.

---

## Marketplace (read)

Mounted at `/api/v1/marketplace`. `requireAuth`.

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | /api/v1/marketplace | requireAuth | List marketplace entries. |
| GET | /api/v1/marketplace/:slug | requireAuth | Fetch a single marketplace entry by slug (404 if not found). |

---

## Network

Mounted at `/api/v1/network`. `requireAuth`.

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | /api/v1/network/map | requireAuth | Cross-instance allow-list map; `meta.isAdmin` flags admin scope. |

---

## Parent organizations

Mounted at `/api/v1/parent-organizations`. `requireAuth` (any logged-in user).

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | /api/v1/parent-organizations | requireAuth | Parent organizations selectable in the membership form: the known Verbünde plus every parent used by a live membership. Returns `{ data: [{ identifier, name, known, usedBy }] }`, known first, then by name. `name` comes from the known list, else the stored organization name, else the identifier; `usedBy` counts live memberships (deleted ones are ignored). |

Membership create/update accept `parentOrganization` as a lower-case identifier (`^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$`, max 255); the value is trimmed and lower-cased before validation.

---

## Audit (cross-instance)

Mounted at `/api/v1/audit` (per-instance audit lives under each instance — see below).

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | /api/v1/audit | requireAuth | Cross-instance audit log; admins see all rows, non-admins only their own instances. Paging `?page=&limit=` (limit ≤ 200) plus the filters below; `meta` has pagination, `isAdmin` and `summary`. |
| GET | /api/v1/audit/export | requireAdmin | CSV / JSON export of the current filter over all sites (`?format=csv\|json` plus the filters below). Non-admins get 403. |
| GET | /api/v1/instances/:instanceId/audit | requireOwner | Per-instance audit log, same filters and `meta` as above. |
| GET | /api/v1/instances/:instanceId/audit/export | requireOwner | CSV / JSON export of the current filter for one site. |

**Filters** (all optional, shared by list and export): `resource`, `operation`, `from` / `to` (ISO date-time, inclusive), `actor` (e-mail contains), `instanceId` (one site; ignored on the per-instance routes, and a non-admin never sees more than their own sites), `q` (free text over user, resource id, IP, site name / identifier / label and the recorded details; `%` and `_` are literal), `flaggedOnly=true`.

**Rows** carry the audit columns plus `instance_label`, `organization_identifier`, `organization_name` and `flags: [{ code, severity }]` (`info` | `warning` | `critical`). `meta.summary` is `{ info, warning, critical, flagged, scanned }`. Flags are computed server-side (`services/auditAnomalies.ts`) over the newest 5 000 rows of the filter, so the summary and `flaggedOnly` cover that window. Rules: bursts of failed sign-in / step-up / rate-limit events per e-mail or IP (5 in 15 min = warning, 10 = critical), rejected private-key uploads, issuers off the CA whitelist or on the blacklist, admin or approval actions between 22:00 and 06:00 Europe/Berlin, 10 or more deletes by one actor in 10 min, admin promotions / sign-in permissions / admin removal, CA list changes, and four-eyes violations on approvals.

**Export.** The response is an attachment `audit-<scope>-<yyyy-mm-dd>.<csv|json>` (`scope` is `all` or `site-<instance id prefix>`), at most 50 000 rows (`X-Audit-Export-Rows`, `X-Audit-Export-Truncated`). CSV is UTF-8 with BOM, CRLF lines and a neutralised formula start (cells beginning with `=`, `+`, `-`, `@`, TAB or CR get a leading `'`); `flags` and `details` are columns. Every export is itself written to the audit log (`resource_type` AUDIT, `operation` EXPORT, with format, row count and filters).

**Events recorded beyond the entity CRUD** (`operation`): `DENIED` (refused certificate upload with `diff_json.reason` `PRIVATE_KEY_REJECTED` / `CA_NOT_WHITELISTED` / `CA_BLACKLISTED`; four-eyes refusals `ALREADY_DECIDED` / `ALREADY_APPROVED_SAME_SITE` on approvals), `STEP_UP_FAILED` (admin step-up failed, reason code only, never the code), `RATE_LIMITED` (sign-in or step-up limit hit, with the bucket), `FAILED_LOGIN` (also for a client certificate that is unknown or belongs to a locked account), `EXPORT`. The IP address list download is recorded as a `CREATE` with `diff_json.action` `ip_address_list_download`. PEM content, codes and secrets are never part of an entry.

---

## Download

Mounted at `/api/v1/instances/:instanceId/download` and `/api/v1/download`.

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | /api/v1/instances/:instanceId/download/full-bundle | requireAuth | Network-wide FHIR bundle (audited). Returns `application/fhir+json` attachment. |
| GET | /api/v1/instances/:instanceId/download/bundle | requireOwner | Per-endpoint signed bundle of the current version. Query `?endpointId=` (required), `&version=<n>` (optional, an older version; 404 if unknown). Signature, content-hash and `X-Bundle-Version` headers. |
| GET | /api/v1/instances/:id/bundle-history | requireOwner | Versions a site can download for one endpoint. Query `?endpointId=` (required, must belong to the instance), `&limit=`. → `{ data: [{ versionNumber, createdAt, triggeredBy, notes, isCurrent }] }`, newest first. |
| GET | /api/v1/instances/:instanceId/download/ip-address-list | requireAdmin | Excel (`.xlsx`) export of all allow-listed IPs. |
| GET | /api/v1/download/ip-address-list | requireAdmin | Same export without instance scope. |
| GET | /api/v1/download/full-bundle | requireAuth | Network-wide bundle without instance scope. |
| GET | /api/v1/download/bundle | requireOwner | Bundle route also reachable without instance scope (requires `endpointId`). |

Note: the `downloadRouter` is mounted twice — under `/api/v1/instances/:instanceId/download` and `/api/v1/download` — so all three handlers (`full-bundle`, `bundle`, `ip-address-list`) exist under both prefixes. `bundle`/`ip-address-list` paths under `/api/v1/download` lack an `:instanceId`, so `requireInstanceOwnership`/scoped lookups behave accordingly.

---

## FHIR

Mounted at `/fhir`. Machine-to-machine; authenticated by client-certificate thumbprint (mTLS), no JWT. Errors are FHIR `OperationOutcome` resources, not the `{ error }` envelope.

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | /fhir/Bundle/mine | mTLS | The same as `/fhir/Bundle/:endpointId` for the endpoint derived from the calling cert's organization: its only endpoint, else the single one whose identifier starts with `fhir.`; otherwise `409` OperationOutcome `AMBIGUOUS_ENDPOINT` listing the endpoint identifiers (use the per-endpoint URL), `404` without endpoints. Same body, headers, `ETag`/`304` and audit entry. |
| GET | /fhir/Bundle/:endpointId | mTLS | The current allow list for one endpoint owned by the calling cert's org: receiver view of the latest bundle version. `Bundle.meta.versionId` / `lastUpdated`, `ETag: W/"<version>"`, `Last-Modified`; 304 on a matching `If-None-Match`. Falls back to the approved state (computed on the fly) while no version has a stored input. |
| GET | /fhir/Bundle/:endpointId/_history | mTLS | FHIR `Bundle` of type `history`, newest first, one entry per version (`fullUrl`, `request`, `response.etag`, `response.lastModified`, no resource). `?_count=` (default 50, max 200). |
| GET | /fhir/Bundle/:endpointId/_history/:vid | mTLS | Receiver view of one version. 404 for an unknown version or one without stored input. |
| GET | /fhir/Bundle | mTLS | Network-wide bundle of the current version. |

Missing cert → 401; cert not registered → 403; unknown endpoint/org/version → 404 (an endpoint of another organization counts as unknown).

---

## Health

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | /health | public | Liveness — always `{ status: "ok" }`. |
| GET | /health/live | public | Liveness alias. |
| GET | /health/ready | public | Readiness — checks DB + Redis; 503 if degraded. |
