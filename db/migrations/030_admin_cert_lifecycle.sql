-- 030_admin_cert_lifecycle.sql
--
-- Admin certificate lifecycle. admin_cert_fingerprints (migration 021) only knew
-- e-mail + fingerprint; to warn before an admin certificate expires and to let
-- admins hand in a successor it also records:
--   subject         certificate subject (CN), filled on upload / first login
--   valid_until     notAfter of the certificate, filled on upload or first login
--   last_used_at    last successful login with this certificate
--   label           free text chosen by the admin ("Laptop", "Nachfolger 2027")
--   last_warned_at  when the last expiry warning mail went out (daily dedupe)
-- Rows created by the IMI_ADMIN_CERT_FINGERPRINTS env bootstrap keep NULL until
-- the certificate is used for the first time.
--
-- Idempotent: information_schema + PREPARE/EXECUTE, safe to re-run.

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admin_cert_fingerprints' AND COLUMN_NAME = 'subject');
SET @sql := IF(@c = 0, 'ALTER TABLE admin_cert_fingerprints ADD COLUMN subject VARCHAR(255) NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admin_cert_fingerprints' AND COLUMN_NAME = 'valid_until');
SET @sql := IF(@c = 0, 'ALTER TABLE admin_cert_fingerprints ADD COLUMN valid_until DATETIME NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admin_cert_fingerprints' AND COLUMN_NAME = 'last_used_at');
SET @sql := IF(@c = 0, 'ALTER TABLE admin_cert_fingerprints ADD COLUMN last_used_at DATETIME NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admin_cert_fingerprints' AND COLUMN_NAME = 'label');
SET @sql := IF(@c = 0, 'ALTER TABLE admin_cert_fingerprints ADD COLUMN label VARCHAR(100) NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admin_cert_fingerprints' AND COLUMN_NAME = 'last_warned_at');
SET @sql := IF(@c = 0, 'ALTER TABLE admin_cert_fingerprints ADD COLUMN last_warned_at DATETIME NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
