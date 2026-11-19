# Database Schema

MySQL 8 / InnoDB, charset `utf8mb4`, collation `utf8mb4_unicode_ci`, database `dsf_allowlist`.
Derived from `db/migrations/001`–`037`. Columns reflect the final state after all `ALTER TABLE` statements.

## email_whitelist

Auth allow-list of permitted login emails. Lock columns (005) disable a user without deletion.

| Column | Type | Nullable | Default | Key |
|---|---|---|---|---|
| id | CHAR(36) | no | UUID() | PK |
| email | VARCHAR(255) | no | — | UNIQUE (uq_email) |
| created_at | DATETIME(3) | no | CURRENT_TIMESTAMP(3) | |
| created_by | VARCHAR(255) | yes | NULL | |
| locked_at | TIMESTAMP | yes | NULL | |
| locked_by | VARCHAR(255) | yes | NULL | |
| locked_reason | TEXT | yes | NULL | |

FKs: none.

## users

Authenticated users with TOTP 2FA state.

| Column | Type | Nullable | Default | Key |
|---|---|---|---|---|
| id | CHAR(36) | no | UUID() | PK |
| email | VARCHAR(255) | no | — | UNIQUE (uq_user_email) |
| totp_secret | VARCHAR(500) | yes | NULL | |
| totp_enabled | TINYINT(1) | no | 0 | |
| backup_codes | JSON | yes | NULL | |
| last_login | DATETIME | yes | NULL | |
| created_at | DATETIME(3) | no | CURRENT_TIMESTAMP(3) | |

FKs: none.

## refresh_tokens

Persisted refresh tokens (hashed). Mirrors the Redis `refresh:` store.

| Column | Type | Nullable | Default | Key |
|---|---|---|---|---|
| id | CHAR(36) | no | UUID() | PK |
| user_id | CHAR(36) | no | — | idx_rt_user |
| token_hash | VARCHAR(64) | no | — | idx_rt_hash |
| expires_at | DATETIME | no | — | |
| created_at | DATETIME(3) | no | CURRENT_TIMESTAMP(3) | |
| revoked_at | DATETIME | yes | NULL | |

FKs: `user_id` → `users.id` ON DELETE CASCADE (fk_rt_user).

## instances

DSF instances owned by a user.

| Column | Type | Nullable | Default | Key |
|---|---|---|---|---|
| id | CHAR(36) | no | UUID() | PK |
| user_id | CHAR(36) | no | — | idx_inst_user |
| label | VARCHAR(255) | no | — | |
| created_at | DATETIME(3) | no | CURRENT_TIMESTAMP(3) | |
| archived_at | DATETIME | yes | NULL | Set while the instance is archived (036) |
| archived_by | VARCHAR(255) | yes | NULL | E-mail of the user who archived it (036) |
| removed_at | DATETIME(3) | yes | NULL | Set when two admins removed the site (039): withdrawn from the allow list, no login, hidden from everyone but admins. Rows are kept |
| removed_by | VARCHAR(255) | yes | NULL | E-mail of the confirming admin (039) |

FKs: `user_id` → `users.id` ON DELETE CASCADE (fk_inst_user).

## organizations

One organization per instance. PK `identifier` is the FQDN and is immutable (trigger, 015).

| Column | Type | Nullable | Default | Key |
|---|---|---|---|---|
| identifier | VARCHAR(255) | no | — | PK |
| instance_id | CHAR(36) | no | — | UNIQUE (uq_org_instance) |
| name | VARCHAR(255) | no | — | |
| active | TINYINT(1) | no | 1 | |
| email | VARCHAR(255) | no | — | |
| address_line | VARCHAR(255) | yes | NULL | |
| postal_code | VARCHAR(20) | yes | NULL | |
| city | VARCHAR(100) | yes | NULL | |
| country_code | CHAR(2) | yes | NULL | |
| client_cert_thumbprint | VARCHAR(128) | yes | NULL | |
| created_at | DATETIME(3) | no | CURRENT_TIMESTAMP(3) | |
| updated_at | DATETIME | no | CURRENT_TIMESTAMP ON UPDATE | |

FKs: `instance_id` → `instances.id` ON DELETE CASCADE (fk_org_inst).

## contacts

Contact persons for an organization. `language` (018) drives notification locale.

| Column | Type | Nullable | Default | Key |
|---|---|---|---|---|
| id | CHAR(36) | no | UUID() | PK |
| organization_id | VARCHAR(255) | no | — | idx_ct_org |
| types | JSON | no | — | |
| name | VARCHAR(255) | yes | NULL | |
| email | VARCHAR(255) | no | — | |
| email_validated | TINYINT(1) | no | 0 | |
| phone | VARCHAR(50) | yes | NULL | |
| address_line | VARCHAR(255) | yes | NULL | |
| city | VARCHAR(100) | yes | NULL | |
| postal_code | VARCHAR(20) | yes | NULL | |
| country_code | CHAR(2) | yes | NULL | |
| language | CHAR(2) | no | 'en' | |
| created_at | DATETIME(3) | no | CURRENT_TIMESTAMP(3) | |
| updated_at | DATETIME | no | CURRENT_TIMESTAMP ON UPDATE | |

FKs: `organization_id` → `organizations.identifier` ON DELETE CASCADE (fk_ct_org).

## endpoints

FHIR endpoints of an organization. PK `identifier` is the FQDN and is immutable (trigger, 015).

| Column | Type | Nullable | Default | Key |
|---|---|---|---|---|
| identifier | VARCHAR(255) | no | — | PK |
| organization_id | VARCHAR(255) | no | — | idx_ep_org |
| name | VARCHAR(255) | yes | NULL | |
| address | VARCHAR(500) | no | — | |
| created_at | DATETIME(3) | no | CURRENT_TIMESTAMP(3) | |
| updated_at | DATETIME | no | CURRENT_TIMESTAMP ON UPDATE | |

FKs: `organization_id` → `organizations.identifier` ON DELETE CASCADE (fk_ep_org).

## endpoint_ips

IP addresses per endpoint, flagged for FHIR / BPE roles.

| Column | Type | Nullable | Default | Key |
|---|---|---|---|---|
| id | CHAR(36) | no | UUID() | PK |
| endpoint_id | VARCHAR(255) | no | — | idx_eip_ep |
| ip | VARCHAR(45) | no | — | |
| is_fhir | TINYINT(1) | no | 0 | |
| is_bpe | TINYINT(1) | no | 0 | |

FKs: `endpoint_id` → `endpoints.identifier` ON DELETE CASCADE (fk_eip_ep).

## certificates

PEM certificates per organization. `last_notified_at` (009) throttles expiry mail.

| Column | Type | Nullable | Default | Key |
|---|---|---|---|---|
| id | CHAR(36) | no | UUID() | PK |
| organization_id | VARCHAR(255) | no | — | idx_cert_org |
| pem | TEXT | no | — | |
| subject | VARCHAR(255) | yes | NULL | |
| thumbprint | VARCHAR(64) | yes | NULL | |
| valid_until | DATE | yes | NULL | |
| created_at | DATETIME(3) | no | CURRENT_TIMESTAMP(3) | |
| last_notified_at | TIMESTAMP | yes | NULL | |
| uploaded_by | VARCHAR(255) | yes | NULL | E-mail of the uploader (031); NULL = unknown, not eligible as login certificate |
| uploaded_by_admin | TINYINT(1) | yes | NULL | Whether the uploading session was an admin (031) |
| publish_in_allowlist | TINYINT(1) | no | 1 | 1 = the SHA-512 thumbprint is published in the allow list (040); 0 = never published |
| use_for_login | TINYINT(1) | no | 1 | 1 = may log in as the organization after approval (040); 0 = never a login certificate |

FKs: `organization_id` → `organizations.identifier` ON DELETE CASCADE (fk_cert_org).

## memberships

Affiliations between an org, a parent org, and an endpoint. `deleted_at` (004) is the soft-delete marker.

| Column | Type | Nullable | Default | Key |
|---|---|---|---|---|
| id | CHAR(36) | no | UUID() | PK |
| organization_id | VARCHAR(255) | no | — | idx_ms_org |
| parent_organization | VARCHAR(255) | no | — | |
| endpoint_id | VARCHAR(255) | no | — | idx_ms_ep |
| roles | JSON | no | — | |
| created_at | DATETIME(3) | no | CURRENT_TIMESTAMP(3) | |
| updated_at | DATETIME | no | CURRENT_TIMESTAMP ON UPDATE | |
| deleted_at | TIMESTAMP | yes | NULL | idx_memberships_deleted_at |

FKs: `organization_id` → `organizations.identifier` ON DELETE CASCADE (fk_ms_org); `endpoint_id` → `endpoints.identifier` ON DELETE CASCADE (fk_ms_ep).

## approval_requests

Approval workflow header. Effective status derived from `approval_signatures` (see `lib/approvalState.ts`).

| Column | Type | Nullable | Default | Key |
|---|---|---|---|---|
| id | CHAR(36) | no | UUID() | PK |
| instance_id | CHAR(36) | no | — | idx_ar_inst (composite with created_at, 020) |
| status | ENUM('DRAFT','PENDING','APPROVED','REJECTED','WITHDRAWN') | no | 'DRAFT' | idx_ar_status |
| created_at | DATETIME(3) | no | CURRENT_TIMESTAMP(3) | |
| submitted_at | DATETIME | yes | NULL | |
| resolved_at | DATETIME | yes | NULL | |
| resolved_by | VARCHAR(255) | yes | NULL | |
| comment | TEXT | yes | NULL | |
| snapshot_json | JSON | yes | NULL | |
| last_reminded_at | TIMESTAMP | yes | NULL | |

FKs: `instance_id` → `instances.id` ON DELETE CASCADE (fk_ar_inst).

## approval_signatures

Per-admin sign-off rows backing the 4-eyes workflow (003).

| Column | Type | Nullable | Default | Key |
|---|---|---|---|---|
| id | CHAR(36) | no | — | PK |
| approval_request_id | CHAR(36) | no | — | idx_signatures_request |
| admin_email | VARCHAR(255) | no | — | UNIQUE w/ request (uq_signatures_request_admin) |
| admin_site | VARCHAR(255) | no | — | |
| decision | ENUM('APPROVE','REJECT') | no | — | idx_signatures_decision |
| signed_at | TIMESTAMP | no | CURRENT_TIMESTAMP | |
| comment | TEXT | yes | NULL | |

FKs: `approval_request_id` → `approval_requests.id` ON DELETE CASCADE (fk_signatures_request). Unique (approval_request_id, admin_email).

## audit_logs

Append-only audit trail. UPDATE/DELETE blocked by triggers (013). `resource_type` and `operation` are extended by migrations 011, 014, 026, 027, 028 and 035.

| Column | Type | Nullable | Default | Key |
|---|---|---|---|---|
| id | CHAR(36) | no | UUID() | PK |
| timestamp | DATETIME | no | CURRENT_TIMESTAMP | idx_al_time |
| user_email | VARCHAR(255) | yes | NULL | idx_al_user |
| instance_id | CHAR(36) | yes | NULL | idx_al_inst |
| resource_type | ENUM('ORGANIZATION','CONTACT','ENDPOINT','CERTIFICATE','MEMBERSHIP','AUTH','APPROVAL','MARKETPLACE','AUDIT','BACKUP','INCIDENT') | no | — | idx_al_res (with resource_id) |
| resource_id | VARCHAR(255) | yes | NULL | idx_al_res |
| operation | ENUM('CREATE','UPDATE','DELETE','APPROVE','REJECT','LOGIN','LOGOUT','OTP_REQUEST','OTP_VERIFY','TOTP_SETUP','TOTP_VERIFY','FAILED_LOGIN','WITHDRAW','DENIED','STEP_UP_FAILED','RATE_LIMITED','EXPORT','DOWNLOAD') | no | — | |
| diff_json | JSON | yes | NULL | |
| ip_address | VARCHAR(45) | yes | NULL | |

FKs: none declared (instance_id is not a constraint).

## admin_grants

Cryptographically signed admin role assignments (006). RS256 signature verified by the app.

| Column | Type | Nullable | Default | Key |
|---|---|---|---|---|
| email | VARCHAR(255) | no | — | PK |
| granted_at | TIMESTAMP | no | — | idx_admin_grants_granted_at |
| granted_by_a | VARCHAR(255) | no | — | |
| granted_by_b | VARCHAR(255) | no | — | |
| signature_hex | TEXT | no | — | |

FKs: none.

## admin_promotion_requests

4-eyes admin promotion workflow (007).

| Column | Type | Nullable | Default | Key |
|---|---|---|---|---|
| id | CHAR(36) | no | — | PK |
| target_email | VARCHAR(255) | no | — | |
| requested_by | VARCHAR(255) | no | — | |
| requested_at | TIMESTAMP | no | — | |
| status | ENUM('PENDING','APPROVED','REJECTED','CANCELLED') | no | 'PENDING' | idx_apr_status |
| approver_b | VARCHAR(255) | yes | NULL | |
| approved_at | TIMESTAMP | yes | NULL | |
| rejected_by | VARCHAR(255) | yes | NULL | |
| rejection_reason | TEXT | yes | NULL | |
| resolved_at | TIMESTAMP | yes | NULL | |

FKs: none.

## marketplace_entries

Process marketplace plugin registry (011), with GitHub metadata (012).

| Column | Type | Nullable | Default | Key |
|---|---|---|---|---|
| id | CHAR(36) | no | — | PK |
| git_url | VARCHAR(255) | no | — | UNIQUE |
| name | VARCHAR(255) | no | — | |
| description | TEXT | yes | NULL | |
| status | ENUM('APPROVED','EXPERIMENTAL','DEPRECATED') | no | 'APPROVED' | idx_status |
| latest_release_tag | VARCHAR(50) | yes | NULL | |
| last_commit_at | TIMESTAMP | yes | NULL | |
| stars | INT | no | 0 | |
| license | VARCHAR(50) | yes | NULL | |
| sync_at | TIMESTAMP | yes | NULL | idx_sync_at |
| sync_error | TEXT | yes | NULL | |
| added_by | VARCHAR(255) | no | — | |
| added_at | TIMESTAMP | no | — | |
| updated_at | TIMESTAMP | no | — | |
| topics | JSON | yes | NULL | |
| forks | INT | no | 0 | |
| open_issues | INT | no | 0 | |
| archived | TINYINT(1) | no | 0 | |
| homepage | VARCHAR(255) | yes | NULL | |
| language | VARCHAR(50) | yes | NULL | |

FKs: none.

## pending_notifications

Persisted delayed-send emails surviving process restarts (010). Flushed when `send_after <= now`.

| Column | Type | Nullable | Default | Key |
|---|---|---|---|---|
| id | CHAR(36) | no | — | PK |
| kind | VARCHAR(64) | no | — | |
| target_email | VARCHAR(255) | no | — | |
| payload_json | JSON | no | — | |
| send_after | TIMESTAMP | no | — | idx_pending_send_after |
| created_at | TIMESTAMP | no | CURRENT_TIMESTAMP | |

FKs: none.

## ca_blacklist

Blacklisted CA Subject DNs checked against a cert's issuer at upload (016).

| Column | Type | Nullable | Default | Key |
|---|---|---|---|---|
| id | CHAR(36) | no | UUID() | PK |
| subject_dn | VARCHAR(500) | no | — | UNIQUE (uq_cab_subject) |
| fingerprint | CHAR(64) | yes | NULL | idx_cab_fingerprint |
| reason | TEXT | yes | NULL | |
| added_by | VARCHAR(255) | no | — | |
| added_at | DATETIME | no | CURRENT_TIMESTAMP | |

FKs: none.

## ca_whitelist

CAs the DSF accepts in production, seeded at init with the DSF 2.1.1 defaults (022). `CLIENT` rows issue DSF client certificates and mark uploaded certificates as DSF-issued; `SERVER` rows are the roots a DSF BPE trusts for TLS servers. Blacklisting a listed CA is refused.

| Column | Type | Nullable | Default | Key |
|---|---|---|---|---|
| id | CHAR(36) | no | UUID() | PK |
| subject_dn | VARCHAR(500) | no | — | UNIQUE with kind (uq_caw_subject_kind) |
| fingerprint | CHAR(64) | yes | NULL | idx_caw_fingerprint |
| kind | VARCHAR(16) | no | — | `CLIENT` or `SERVER` |
| not_after | DATE | yes | NULL | |
| source | VARCHAR(32) | no | 'manual' | `dsf-2.1.1` for the seeded rows |
| reason | TEXT | yes | NULL | |
| added_by | VARCHAR(255) | no | — | |
| added_at | DATETIME | no | CURRENT_TIMESTAMP | |

FKs: none.

## known_cas

Cached Mozilla trust-store snapshot for the admin CA picker (016).

| Column | Type | Nullable | Default | Key |
|---|---|---|---|---|
| fingerprint | CHAR(64) | no | — | PK |
| subject_dn | VARCHAR(500) | no | — | idx_known_subject |
| source | VARCHAR(64) | no | 'mozilla' | |
| synced_at | DATETIME | no | CURRENT_TIMESTAMP | |

FKs: none.

## marketplace_releases

Release history of a marketplace entry (019).

| Column | Type | Nullable | Default | Key |
|---|---|---|---|---|
| id | CHAR(36) | no | — | PK |
| entry_id | CHAR(36) | no | — | UNIQUE with tag (uq_entry_tag) |
| tag | VARCHAR(100) | no | — | |
| published_at | TIMESTAMP | yes | NULL | |

FKs: `entry_id` → `marketplace_entries.id` ON DELETE CASCADE (fk_mp_rel_entry).

## admin_cert_fingerprints

Client certificates an admin (who has no organization) may sign in with (021, 030).

| Column | Type | Nullable | Default | Key |
|---|---|---|---|---|
| id | CHAR(36) | no | UUID() | PK |
| email | VARCHAR(255) | no | — | idx_admin_cert_email |
| fingerprint | VARCHAR(128) | no | — | UNIQUE (uq_admin_cert_fp) |
| created_at | DATETIME | no | CURRENT_TIMESTAMP | |
| created_by | VARCHAR(255) | yes | NULL | |
| subject | VARCHAR(255) | yes | NULL | Certificate subject (030) |
| valid_until | DATETIME | yes | NULL | notAfter of the certificate (030) |
| last_used_at | DATETIME | yes | NULL | Last successful login (030) |
| label | VARCHAR(100) | yes | NULL | Free text chosen by the admin (030) |
| last_warned_at | DATETIME | yes | NULL | Last expiry warning mail (030) |

## admin_cert_requests

Four-eyes requests to register an admin certificate for a colleague (031). The PEM is a public certificate and is kept to re-validate it at approval time.

| Column | Type | Nullable | Default | Key |
|---|---|---|---|---|
| id | CHAR(36) | no | — | PK |
| target_email | VARCHAR(255) | no | — | idx_acr_target |
| fingerprint | CHAR(128) | no | — | |
| subject | VARCHAR(255) | yes | NULL | |
| valid_until | DATETIME | yes | NULL | |
| label | VARCHAR(100) | yes | NULL | |
| pem | TEXT | no | — | |
| requested_by | VARCHAR(255) | no | — | |
| status | ENUM('PENDING','APPROVED','REJECTED','CANCELLED') | no | 'PENDING' | idx_acr_status_created (with created_at) |
| decided_by | VARCHAR(255) | yes | NULL | |
| decided_at | DATETIME(3) | yes | NULL | |
| comment | TEXT | yes | NULL | |
| created_at | DATETIME(3) | no | — | |
| pending_fp | CHAR(128) | generated | fingerprint while PENDING, else NULL | UNIQUE (uq_acr_one_pending_fp): one pending request per certificate |

## instance_removal_requests

Four-eyes requests to remove a whole site (039). Admin A requests, an admin of another e-mail domain confirms; the requester may cancel while PENDING. Executing it sets `instances.removed_at`. No FK: the row outlives a (never approved) instance that is deleted later.

| Column | Type | Nullable | Default | Key |
|---|---|---|---|---|
| id | CHAR(36) | no | — | PK |
| instance_id | CHAR(36) | no | — | idx_irr_instance |
| organization_id | VARCHAR(255) | yes | NULL | Identifier at request time |
| reason | TEXT | no | — | |
| requested_by | VARCHAR(255) | no | — | |
| requested_at | DATETIME(3) | no | — | idx_irr_status (with status) |
| status | ENUM('PENDING','CONFIRMED','CANCELLED') | no | 'PENDING' | |
| decided_by | VARCHAR(255) | yes | NULL | Confirming admin, or the requester on cancel |
| decided_at | DATETIME(3) | yes | NULL | |
| version_number | INT | yes | NULL | Allow-list version published on execution; NULL when publishing failed |
| pending_instance | CHAR(36) | generated | instance_id while PENDING, else NULL | UNIQUE (uq_irr_one_pending): one pending request per instance |

## bundle_versions

Full FHIR bundle snapshots persisted on each approval (017). Signed with RS256 over `content_hash`.

| Column | Type | Nullable | Default | Key |
|---|---|---|---|---|
| id | CHAR(36) | no | UUID() | PK |
| version_number | INT | no | AUTO_INCREMENT | UNIQUE (uq_bv_version) |
| created_at | DATETIME | no | CURRENT_TIMESTAMP | idx_bv_created |
| triggered_by | ENUM('APPROVAL','MANUAL','RESTORE') | no | — | |
| approval_request_id | CHAR(36) | yes | NULL | idx_bv_approval |
| triggered_by_email | VARCHAR(255) | no | — | |
| content_hash | CHAR(64) | no | — | |
| signature | TEXT | no | — | |
| bundle_json | LONGTEXT | no | — | |
| notes | TEXT | yes | NULL | |
| input_json | LONGTEXT | yes | NULL | Network state the bundle was built from (members, withdrawn organizations, parent names; no contact data), added in 024. NULL on older versions, which are not restorable and not readable per receiver. |

FKs: `approval_request_id` → `approval_requests.id` ON DELETE SET NULL (fk_bv_approval).

## bundle_restore_requests

Four-eyes requests to publish an old bundle version again (025). A second admin from a different site approves or rejects; approval creates the new RESTORE version.

| Column | Type | Nullable | Default | Key |
|---|---|---|---|---|
| id | CHAR(36) | no | — | PK |
| source_version_id | CHAR(36) | no | — | FK → bundle_versions.id |
| reason | VARCHAR(500) | no | — | |
| requested_by | VARCHAR(255) | no | — | |
| requested_at | DATETIME(3) | no | — | idx_brr_requested |
| status | ENUM('PENDING','APPROVED','REJECTED','CANCELLED') | no | 'PENDING' | |
| decided_by | VARCHAR(255) | yes | NULL | |
| decided_at | DATETIME(3) | yes | NULL | |
| decision_comment | TEXT | yes | NULL | Rejection comment |
| resulting_version_id | CHAR(36) | yes | NULL | The RESTORE version created on approval |
| pending_slot | TINYINT (generated, stored) | yes | 1 while PENDING, else NULL | UNIQUE uq_brr_one_pending: at most one pending request |

FKs: `source_version_id` → `bundle_versions.id` ON DELETE CASCADE (fk_brr_source).

## org_login_certificates

Which client certificates may log in as an organization (029). A login through an entry yields a session scoped to the organization's instance. Managed by admins; `organizations.client_cert_fingerprint` is deprecated and no longer read.

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| fingerprint | CHAR(128) | no | — | PK; SHA-512 of the certificate DER, lower-case hex. One certificate logs in for at most one organization |
| organization_id | VARCHAR(255) | no | — | FK → organizations.identifier ON DELETE CASCADE |
| certificate_id | CHAR(36) | yes | NULL | FK → certificates.id ON DELETE CASCADE; NULL for fingerprint-only entries |
| source | ENUM | no | — | ONBOARDING, ADMIN, MIGRATED, APPROVAL (033) |
| created_by | VARCHAR(255) | yes | NULL | |
| created_at | DATETIME(3) | no | — | |
| valid_until | DATETIME | yes | NULL | Expiry of the linked certificate, kept after a renewal unlinks it (033) |

## certificate_thumbprint_locks

Serializes registrations of the same certificate (034). Uploading or renewing a certificate upserts the row of its SHA-256 thumbprint (`INSERT ... ON DUPLICATE KEY UPDATE`, an exclusive row lock held until commit) and only then checks that no other organization holds the certificate. A concurrent registration of the same thumbprint waits and then sees the first one's row (`CERT_REGISTERED_ELSEWHERE`). The row carries no ownership and is never deleted. No personal data.

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| thumbprint | VARCHAR(64) | no | — | PK; SHA-256 thumbprint as in `certificates.thumbprint` |

## allowlist_fetches

The newest allow-list version each site (instance) has obtained (032). One row per instance, upserted when the site's DSF fetches its receiver bundle over mTLS (200, or 304 with a matching ETag) or when someone downloads the bundle for that instance in the portal. The version number never decreases. The portal compares it with the current `bundle_versions` row to show the "new allow list available" nudge. No personal data.

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| instance_id | CHAR(36) | no | — | PK; FK → instances.id ON DELETE CASCADE |
| version_number | INT | no | — | `bundle_versions.version_number` of the newest obtained version |
| via | ENUM | no | — | DSF (mTLS fetch), PORTAL (download in the GUI) |
| fetched_at | DATETIME(3) | no | — | When that version was last obtained |

## backup_settings

Schedule of the application backups (028). A single row, `id = 1` (CHECK), seeded with the defaults.

| Column | Type | Nullable | Default | Key |
|---|---|---|---|---|
| id | TINYINT | no | — | PK (CHECK id = 1) |
| enabled | TINYINT(1) | no | 1 | |
| mode | ENUM('EVERY_6H','EVERY_12H','DAILY') | no | 'DAILY' | |
| daily_time | CHAR(5) | no | '02:30' | HH:MM, Europe/Berlin, used when mode is DAILY |
| retention_count | INT | no | 14 | CHECK 7 to 365 |
| updated_by | VARCHAR(255) | yes | NULL | |
| updated_at | DATETIME(3) | yes | NULL | |

## backup_runs

One row per backup attempt, scheduled or manual (028). Pruned files keep their row (`file_deleted = 1`).

| Column | Type | Nullable | Default | Key |
|---|---|---|---|---|
| id | CHAR(36) | no | — | PK |
| started_at | DATETIME(3) | no | — | idx_backup_runs_started |
| finished_at | DATETIME(3) | no | — | |
| trigger_type | ENUM('SCHEDULED','MANUAL') | no | — | |
| triggered_by | VARCHAR(255) | yes | NULL | Admin email, NULL for scheduled runs |
| status | ENUM('SUCCESS','FAILED') | no | — | |
| file_name | VARCHAR(255) | yes | NULL | Under BACKUP_DIR |
| size_bytes | BIGINT | yes | NULL | |
| sha256 | CHAR(64) | yes | NULL | SHA-256 of the file as written |
| encrypted | TINYINT(1) | no | 0 | AES-256-GCM (BACKUP_ENCRYPTION_KEY) |
| duration_ms | INT | no | — | |
| error | VARCHAR(1000) | yes | NULL | |
| file_deleted | TINYINT(1) | no | 0 | Removed by retention |

`audit_logs.resource_type` gains `'BACKUP'` and `audit_logs.operation` gains `'DOWNLOAD'` in 028 (appended to the ENUMs as they stand in the live database).

## incidents

The incident register (035). One row per reported security incident; rows are never deleted. Anyone signed in reports, one admin confirms, suspends, lifts and closes (step-up, no four-eyes). The description is shown to admins and the reporter only and never mailed. `detected_at` is the time the site became aware of the incident ("Kenntnis erlangt am", BSIG 32) and starts the NIS2 deadlines shown in the portal (early warning 24 h, notification 72 h); the final report is due one calendar month after the notification tick (provisionally after the 72 h deadline), or one month after the closure once a progress report is due. The `bsi_*` columns record who ticked "reported to BSI" per stage; `nis2_data` holds the structured report fields per stage (037). The portal never reports to the BSI itself; it is a filling aid and a record. Personal data: reporter, admin and acknowledging user e-mails.

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| id | CHAR(36) | no | — | PK |
| organization_id | VARCHAR(255) | yes | NULL | Affected site; FK → organizations.identifier ON DELETE SET NULL; NULL when unknown |
| title | VARCHAR(200) | no | — | Short title; mailed |
| description | TEXT | no | — | Reporter's free text; admins and reporter only, never mailed |
| status | ENUM | no | 'REPORTED' | REPORTED, CONFIRMED, CLOSED, FALSE_ALARM |
| reported_by / reported_at | VARCHAR(255) / DATETIME(3) | no | — | |
| reported_by_instance_id | CHAR(36) | yes | NULL | Instance of the organization certificate session the report came through; NULL for a personal login. The reporter is e-mail plus this scope. |
| detected_at | DATETIME(3) | no | — | Time of becoming aware; defaults to the report time; admins may correct it (column name kept, labelled "became aware at" in the UI) |
| escalation_level | TINYINT | no | 1 | 1 operation continues, 2 pause, 3 shutdown |
| zulip_url | VARCHAR(500) | yes | NULL | https link to the coordination thread |
| confirmed_by / confirmed_at | VARCHAR(255) / DATETIME(3) | yes | NULL | Confirmed incidents are visible to every signed-in user |
| closed_by / closed_at | VARCHAR(255) / DATETIME(3) | yes | NULL | |
| suspended | TINYINT(1) | no | 0 | 1 while the incident suspends the site: published as withdrawn whatever its approved snapshot says |
| bsi_early_warning_at / _by | DATETIME(3) / VARCHAR(255) | yes | NULL | "Reported to BSI", stage 24 h |
| bsi_notification_at / _by | DATETIME(3) / VARCHAR(255) | yes | NULL | Stage 72 h |
| bsi_final_report_at / _by | DATETIME(3) / VARCHAR(255) | yes | NULL | Final report stage |
| bsi_interim_requested_at / _by | DATETIME(3) / VARCHAR(255) | yes | NULL | The BSI asked for an interim report on this date (037) |
| bsi_interim_at / _by | DATETIME(3) / VARCHAR(255) | yes | NULL | Interim report ticked as reported (037) |
| bsi_progress_at / _by | DATETIME(3) / VARCHAR(255) | yes | NULL | Progress report ticked as reported (037) |
| nis2_data | JSON | yes | NULL | Report fields per stage, e.g. `{"earlyWarning":{"suspectedMalicious":"yes","crossBorder":"no","affectedServices":"BPE"},"notification":{"severity":"high","impact":"…","iocs":"…"},"finalReport":{"rootCause":"…","mitigation":"…","crossBorderFinal":"no"}}`. Admins, the reporter and users of the affected site see and edit them; a stage cannot be ticked with required fields missing; the fields of a ticked stage are locked. Covered by the hash chain (`fieldSha256`: `nis2EarlyWarning`, `nis2Notification`, `nis2FinalReport`); events and audit entries carry field names only (037) |
| dpo_informed_at / _by | DATETIME(3) / VARCHAR(255) | yes | NULL | Data protection officer informed |

Indexes: `idx_incidents_status (status, reported_at)`, `idx_incidents_org (organization_id, suspended)`.

## incident_events

Append-only timeline of an incident (035): UPDATE/DELETE blocked by triggers, like `audit_logs`. The REPORTED event records `details.fieldSha256` (SHA-256 of title, description, organization and detection time), an UPDATED event of the detection time the new hash; the check compares them with the stored incident. The chain must start with REPORTED. Each row is chained to its predecessor: `hash = SHA-256(prev_hash + canonical JSON of {incidentId, seq, at, actorEmail, type, details})` with sorted object keys, `prev_hash` of the first event is 64 zeros. Appending locks the incident row (`SELECT ... FOR UPDATE`) inside the transaction, so concurrent events cannot fork the chain. The detail view and the export verify the chain and name the first broken `seq`.

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| id | CHAR(36) | no | — | PK |
| incident_id | CHAR(36) | no | — | FK → incidents.id |
| seq | INT | no | — | 1, 2, 3 … per incident; unique (incident_id, seq) |
| at | DATETIME(3) | no | — | |
| actor_email | VARCHAR(255) | no | — | |
| type | ENUM | no | — | REPORTED, CONFIRMED, SUSPENDED, MEASURE, COMMENT, SUSPENSION_LIFTED, CLOSED, FALSE_ALARM, UPDATED, ARCHIVED, BLOCK_LIFT_REQUESTED, BLOCKS_LIFTED |
| details | JSON | yes | NULL | Measure results, restart checklist, review note, field changes |
| prev_hash | CHAR(64) | no | — | Hash of the previous event |
| hash | CHAR(64) | no | — | Hash of this event |

## blocked_certificate_thumbprints

SHA-512 thumbprints blocked by an incident (035). A block is effective until two admins lifted it for a false alarm (see `certificate_block_lifts`, 041); the row itself stays for good: such a certificate is refused on upload and renewal for every organization (`CERT_BLOCKED`), never enabled or synced as a login certificate, never logs in, and is left out of every published allow list. A site whose every thumbprint is blocked is published as withdrawn until a new certificate is approved. Rows are never deleted (UPDATE/DELETE blocked by triggers). No personal data besides the acting admin.

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| fingerprint | CHAR(128) | no | — | PK (with incident_id since 041); SHA-512, lower-case hex, as in `org_login_certificates.fingerprint` |
| incident_id | CHAR(36) | no | — | PK (with fingerprint since 041); FK → incidents.id |
| created_by | VARCHAR(255) | no | — | |
| created_at | DATETIME(3) | no | — | |

`audit_logs.resource_type` gains `'INCIDENT'` in 035 (appended to the ENUM as it stands in the live database).

## certificate_block_lift_requests

Four-eyes requests to lift the certificate blocks of a false-alarm incident (041). Admin A requests with a reason, an admin of another e-mail domain confirms; the requester may cancel while PENDING.

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| id | CHAR(36) | no | — | PK |
| incident_id | CHAR(36) | no | — | FK → incidents.id (collation of incidents.id) |
| reason | TEXT | no | — | |
| requested_by | VARCHAR(255) | no | — | |
| requested_at | DATETIME(3) | no | — | |
| status | ENUM('PENDING','CONFIRMED','CANCELLED') | no | 'PENDING' | |
| decided_by | VARCHAR(255) | yes | NULL | |
| decided_at | DATETIME(3) | yes | NULL | |
| pending_incident | CHAR(36) | generated | incident_id while PENDING, else NULL | UNIQUE (uq_cblr_one_pending): one pending request per incident |

## certificate_block_lifts

The final, append-only record of a lifted block (041): one row per (fingerprint, incident), written when the second admin confirms. UPDATE/DELETE are blocked by triggers (`certificate_block_lifts_no_update` / `_no_delete`). A block in `blocked_certificate_thumbprints` counts only while no lift row exists for its (fingerprint, incident); the allow list, login, login sync and the upload and admin-certificate guards all read this through `incident-blocks.service.effectiveBlocks`.

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| id | CHAR(36) | no | — | PK |
| fingerprint | CHAR(128) | no | — | SHA-512, collation of `blocked_certificate_thumbprints.fingerprint`; UNIQUE with incident_id |
| incident_id | CHAR(36) | no | — | FK → incidents.id |
| request_id | CHAR(36) | no | — | The confirmed request |
| requested_by | VARCHAR(255) | no | — | |
| requested_at | DATETIME(3) | no | — | |
| confirmed_by | VARCHAR(255) | no | — | Admin of another e-mail domain than requested_by |
| confirmed_at | DATETIME(3) | no | — | |
| reason | TEXT | no | — | |
