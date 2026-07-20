-- 021_client_cert_sha512_and_admin_certs.sql
--
-- mTLS login is moving from a SHA-256 thumbprint to a SHA-512 fingerprint per
-- organization (client_cert_fingerprint), and IMI admins — who have no
-- organization — get their own certificate-based login via the new
-- admin_cert_fingerprints table.
--
-- organizations.client_cert_thumbprint (SHA-256) and certificates.thumbprint
-- (SHA-256, FHIR bundles) are untouched.
--
-- Idempotent: information_schema + PREPARE/EXECUTE, safe to re-run.

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'organizations'
    AND COLUMN_NAME = 'client_cert_fingerprint'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE organizations ADD COLUMN client_cert_fingerprint VARCHAR(128) NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'organizations'
    AND INDEX_NAME = 'uq_org_cert_fp'
);
SET @sql := IF(@idx_exists = 0,
  'ALTER TABLE organizations ADD UNIQUE INDEX uq_org_cert_fp (client_cert_fingerprint)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @tbl_exists := (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admin_cert_fingerprints'
);
SET @sql := IF(@tbl_exists = 0,
  'CREATE TABLE admin_cert_fingerprints (
     id          CHAR(36)     NOT NULL DEFAULT (UUID()),
     email       VARCHAR(255) NOT NULL,
     fingerprint VARCHAR(128) NOT NULL,
     created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
     created_by  VARCHAR(255),
     PRIMARY KEY (id),
     UNIQUE KEY uq_admin_cert_fp (fingerprint),
     KEY idx_admin_cert_email (email)
   ) ENGINE=InnoDB',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
