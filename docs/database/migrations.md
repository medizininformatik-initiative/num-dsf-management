# Migration Catalog

Chronological list of `db/migrations/*.sql`. Purpose taken from each file's leading comment.
All migrations are idempotent (existence-guarded) except 013–018, which run unconditionally.

| # | File | Purpose | Triggers / Constraints |
|---|---|---|---|
| 001 | 001_initial_schema.sql | Create database and base tables: email_whitelist, users, refresh_tokens, instances, organizations, contacts, endpoints, endpoint_ips, certificates, memberships, approval_requests, audit_logs | FKs + unique keys |
| 002 | 002_client_cert_thumbprint.sql | Add organizations.client_cert_thumbprint for mTLS | — |
| 003 | 003_approval_signatures.sql | Create approval_signatures table for 4-eyes approval workflow | FK to approval_requests; unique (request, admin) |
| 004 | 004_memberships_deleted_at.sql | Add memberships.deleted_at soft-delete column + index | — |
| 005 | 005_email_whitelist_lock.sql | Add lock lifecycle columns (locked_at/by/reason) to email_whitelist | — |
| 006 | 006_admin_grants.sql | Create admin_grants table (RS256-signed role assignments) | — |
| 007 | 007_admin_promotion_requests.sql | Create admin_promotion_requests (4-eyes promotion workflow) | — |
| 008 | 008_approval_request_last_reminded_at.sql | Add approval_requests.last_reminded_at to throttle reminders | — |
| 009 | 009_certificates_last_notified_at.sql | Add certificates.last_notified_at to dedupe expiry mail | — |
| 010 | 010_pending_notifications.sql | Create pending_notifications table for delayed-send emails | — |
| 011 | 011_marketplace_entries.sql | Create marketplace_entries; extend audit_logs.resource_type ENUM with MARKETPLACE | ENUM modify |
| 012 | 012_marketplace_extra_fields.sql | Add GitHub metadata columns to marketplace_entries (topics, forks, open_issues, archived, homepage, language) | — |
| 013 | 013_audit_log_immutability.sql | Enforce append-only audit_logs at DB level | Triggers: audit_logs_no_update, audit_logs_no_delete |
| 014 | 014_audit_logs_marketplace_enum.sql | Rewrite audit_logs.resource_type ENUM to include MARKETPLACE (idempotent reapply of 011 change) | ENUM modify |
| 015 | 015_endpoint_org_identifier_immutability.sql | Make endpoint/organization identifier (FQDN) immutable | Triggers: endpoints_identifier_immutable, organizations_identifier_immutable |
| 016 | 016_ca_blacklist.sql | Create ca_blacklist and known_cas tables for CA upload checks | — |
| 017 | 017_bundle_versions.sql | Create bundle_versions table for FHIR bundle snapshots | FK to approval_requests (ON DELETE SET NULL) |
| 018 | 018_contacts_language.sql | Add contacts.language for per-contact notification locale | — |
| 019 | 019_marketplace_v2.sql | Marketplace v2: add DSF metadata, trust-signal, and slug columns to marketplace_entries; create marketplace_releases table for release history (shipped in v0.1.2) | — |
| 022 | 022_ca_whitelist.sql | Create ca_whitelist and seed it with the CAs DSF 2.1.1 accepts (client certificate CAs and server roots) | — |
| 023 | 023_approval_requests_created_at_ms.sql | approval_requests.created_at in milliseconds, so the latest request of an instance is unambiguous | — |
| 024 | 024_bundle_versions_input.sql | bundle_versions.input_json: the builder input of each version, so receiver views and restores can be rebuilt (older versions stay NULL and are not restorable) | Nullable LONGTEXT column |
| 025 | 025_bundle_restore_requests.sql | Create bundle_restore_requests: four-eyes requests to restore an old bundle version (a unique key on a generated column allows one PENDING request at a time) | FK to bundle_versions (ON DELETE CASCADE) |
| 028 | 028_backup_settings.sql | Create backup_settings (single-row schedule) and backup_runs (history of backup attempts); append 'BACKUP' to audit_logs.resource_type and 'DOWNLOAD' to audit_logs.operation, preserving the values already in the live ENUMs | — |
| 029 | 029_org_login_certificates.sql | Create org_login_certificates (admin-managed certificate login: SHA-512 fingerprint to organization, optional link to an uploaded certificate, source ONBOARDING/ADMIN/MIGRATED) and backfill it from organizations.client_cert_fingerprint (MIGRATED, certificate linked by the SHA-512 of its PEM); the old column is deprecated and no longer read | — |
| 032 | 032_allowlist_fetches.sql | Create allowlist_fetches: per instance the newest allow-list version it obtained, through its DSF (mTLS fetch) or a portal download, so the portal can nudge a site that has not picked up a new version | FK to instances (ON DELETE CASCADE) |
| 033 | 033_login_certificates_from_allow_list.sql | Login certificates follow the approved allow list: add source APPROVAL to org_login_certificates (entries enabled by an approved snapshot thumbprint) and valid_until (expiry of the certificate behind the entry, kept when a renewal unlinks it, used by the daily 30-day cleanup); backfill valid_until from linked certificates | ENUM modify |
| 034 | 034_certificate_thumbprint_locks.sql | Create certificate_thumbprint_locks: one lock row per certificate thumbprint, locked inside the upload/renewal transaction so the "one organization per certificate" check and the insert are atomic (two organizations uploading the same PEM at once no longer both succeed). Not a unique index on certificates.thumbprint, because the same organization may upload a certificate more than once | PK thumbprint |
| 035 | 035_incidents.sql | Incident register: create incidents (status, escalation level 1-3, detection time for the NIS2 deadlines, suspension flag, BSI-reported ticks per stage, DPO informed, Zulip link), incident_events (append-only timeline, SHA-256 hash chain prev_hash/hash ordered by seq) and blocked_certificate_thumbprints (SHA-512 thumbprints an incident blocked for good); append INCIDENT to audit_logs.resource_type | FK incidents → organizations (ON DELETE SET NULL, organization_id takes the collation of organizations.identifier); FK events/blocks → incidents; unique (incident_id, seq); Triggers: incident_events_no_update/_no_delete, blocked_certificate_thumbprints_no_update/_no_delete |
