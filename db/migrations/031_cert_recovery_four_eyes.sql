-- 031_cert_recovery_four_eyes.sql
--
-- Closes two impersonation paths.
--
-- 1. Recovering a certificate for a colleague admin is a four-eyes decision:
--    admin A requests it, a third admin C (not A, not the target B, other
--    site than A) approves. admin_cert_requests holds the request. The PEM is
--    a public certificate (never a key) and is kept to re-validate it at
--    approval time. pending_fp is the fingerprint while the request is PENDING
--    and NULL afterwards; its UNIQUE key allows only one pending request per
--    certificate, even under concurrent requests.
--
-- 2. Only a certificate that the clinic itself uploaded may be flagged as
--    login certificate. certificates.uploaded_by / uploaded_by_admin record who
--    uploaded it and whether that session was an admin. NULL (unknown) is
--    treated as NOT eligible. Backfilled from the audit log; an uploader who
--    currently holds an admin grant counts as admin.
--
-- Idempotent: information_schema + PREPARE/EXECUTE, safe to re-run.

SET @t := (SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admin_cert_requests');
SET @sql := IF(@t = 0,
  'CREATE TABLE admin_cert_requests (
     id            CHAR(36) PRIMARY KEY,
     target_email  VARCHAR(255) NOT NULL,
     fingerprint   CHAR(128) NOT NULL,
     subject       VARCHAR(255) NULL,
     valid_until   DATETIME NULL,
     label         VARCHAR(100) NULL,
     pem           TEXT NOT NULL,
     requested_by  VARCHAR(255) NOT NULL,
     status        ENUM("PENDING","APPROVED","REJECTED","CANCELLED") NOT NULL DEFAULT "PENDING",
     decided_by    VARCHAR(255) NULL,
     decided_at    DATETIME(3) NULL,
     comment       TEXT NULL,
     created_at    DATETIME(3) NOT NULL,
     pending_fp    CHAR(128) AS (IF(status = "PENDING", fingerprint, NULL)) STORED,
     UNIQUE KEY uq_acr_one_pending_fp (pending_fp),
     KEY idx_acr_status_created (status, created_at),
     KEY idx_acr_target (target_email)
   ) ENGINE=InnoDB',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'certificates' AND COLUMN_NAME = 'uploaded_by');
SET @sql := IF(@c = 0, 'ALTER TABLE certificates ADD COLUMN uploaded_by VARCHAR(255) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'certificates' AND COLUMN_NAME = 'uploaded_by_admin');
SET @sql := IF(@c = 0, 'ALTER TABLE certificates ADD COLUMN uploaded_by_admin TINYINT(1) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Backfill: uploader = user of the earliest CREATE audit entry of the certificate.
UPDATE certificates c
   SET c.uploaded_by = (
     SELECT a.user_email FROM audit_logs a
      WHERE a.resource_type = 'CERTIFICATE' AND a.operation = 'CREATE'
        AND a.resource_id COLLATE utf8mb4_unicode_ci = c.id COLLATE utf8mb4_unicode_ci
        AND a.user_email IS NOT NULL
      ORDER BY a.timestamp ASC LIMIT 1)
 WHERE c.uploaded_by IS NULL;

UPDATE certificates c
   SET c.uploaded_by_admin = IF(EXISTS (
     SELECT 1 FROM admin_grants g
      WHERE g.email COLLATE utf8mb4_unicode_ci = c.uploaded_by COLLATE utf8mb4_unicode_ci), 1, 0)
 WHERE c.uploaded_by IS NOT NULL AND c.uploaded_by_admin IS NULL;
