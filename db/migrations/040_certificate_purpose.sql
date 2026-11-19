-- 040_certificate_purpose.sql
--
-- A site decides per certificate what it is used for:
--
--   certificates.publish_in_allowlist   1 = the SHA-512 thumbprint is published in
--                                       the allow list (DSF needs at least one);
--                                       0 = never published.
--   certificates.use_for_login          1 = after approval the certificate may log
--                                       in as the organization (login sync);
--                                       0 = never a login certificate.
--
-- Existing rows keep both = 1, i.e. the behaviour before this migration. A
-- certificate with publish = 0 and login = 1 is "login only": it is never part
-- of a bundle. Changing a flag changes the approval snapshot and needs a new
-- approval like any other certificate change.
--
-- Idempotent: information_schema + PREPARE/EXECUTE; safe to re-run.

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'certificates' AND COLUMN_NAME = 'publish_in_allowlist');
SET @sql := IF(@c = 0,
  'ALTER TABLE certificates ADD COLUMN publish_in_allowlist TINYINT(1) NOT NULL DEFAULT 1',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'certificates' AND COLUMN_NAME = 'use_for_login');
SET @sql := IF(@c = 0,
  'ALTER TABLE certificates ADD COLUMN use_for_login TINYINT(1) NOT NULL DEFAULT 1',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
