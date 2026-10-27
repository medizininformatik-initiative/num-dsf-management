-- 033_login_certificates_from_allow_list.sql
--
-- Login certificates follow the approved allow list.
--
--   source APPROVAL   an entry created because the certificate's SHA-512
--                     thumbprint is in an approved allow-list snapshot of the
--                     organization (four-eyes approval or silent consent).
--                     Such entries are removed again when a later approved
--                     snapshot no longer lists the thumbprint.
--   valid_until       expiry of the certificate behind the entry, copied from
--                     the linked certificate. It survives a renewal that
--                     unlinks the entry, so the daily cleanup can remove
--                     login entries 30 days after expiry. NULL = unknown
--                     (fingerprint-only entries never linked to a PEM).
--
-- Backfill: valid_until of every linked entry from its certificate.
--
-- Idempotent: information_schema + PREPARE/EXECUTE; safe to re-run.

SET @t := (SELECT COLUMN_TYPE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'org_login_certificates' AND COLUMN_NAME = 'source');
SET @sql := IF(@t NOT LIKE '%APPROVAL%',
  'ALTER TABLE org_login_certificates MODIFY source ENUM("ONBOARDING","ADMIN","MIGRATED","APPROVAL") NOT NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'org_login_certificates' AND COLUMN_NAME = 'valid_until');
SET @sql := IF(@c = 0, 'ALTER TABLE org_login_certificates ADD COLUMN valid_until DATE NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE org_login_certificates l
  JOIN certificates c ON c.id = l.certificate_id
   SET l.valid_until = c.valid_until
 WHERE l.valid_until IS NULL;
