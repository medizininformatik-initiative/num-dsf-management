-- 029_org_login_certificates.sql
--
-- Admin-managed certificate login. A client certificate (SHA-512 fingerprint)
-- may log in as ONE organization only when it is listed here. A login through
-- such a certificate yields a session scoped to that organization's instance
-- (auth.service.resolveCertLogin).
--
--   org_login_certificates  fingerprint is the primary key, so a certificate can
--                           log in for at most one organization. certificate_id
--                           links an uploaded certificate of the organization
--                           (NULL for fingerprint-only entries from onboarding
--                           or the backfill); deleting the certificate removes
--                           the login entry. source records where the entry
--                           came from.
--
-- The backfill copies every organizations.client_cert_fingerprint as source
-- MIGRATED and links the uploaded certificate with the same SHA-512
-- (computed in SQL from the PEM body). organizations.client_cert_fingerprint is
-- DEPRECATED: nothing reads it for login after this migration. It stays (and
-- onboarding still mirrors into it) so that a rollback of the application
-- keeps working.
--
-- Idempotent: information_schema + PREPARE/EXECUTE, INSERT IGNORE; safe to re-run.

SET @t := (SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'org_login_certificates');
SET @sql := IF(@t = 0,
  'CREATE TABLE org_login_certificates (
     fingerprint      CHAR(128)    NOT NULL PRIMARY KEY,
     organization_id  VARCHAR(255) NOT NULL,
     certificate_id   CHAR(36)     NULL,
     source           ENUM("ONBOARDING","ADMIN","MIGRATED") NOT NULL,
     created_by       VARCHAR(255) NULL,
     created_at       DATETIME(3)  NOT NULL,
     KEY idx_olc_org (organization_id),
     KEY idx_olc_cert (certificate_id),
     CONSTRAINT fk_olc_org FOREIGN KEY (organization_id) REFERENCES organizations (identifier) ON DELETE CASCADE,
     CONSTRAINT fk_olc_cert FOREIGN KEY (certificate_id) REFERENCES certificates (id) ON DELETE CASCADE
   ) ENGINE=InnoDB',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

INSERT IGNORE INTO org_login_certificates
  (fingerprint, organization_id, certificate_id, source, created_by, created_at)
SELECT LOWER(o.client_cert_fingerprint), o.identifier,
  (SELECT c.id FROM certificates c
    WHERE c.organization_id = o.identifier
      AND SHA2(FROM_BASE64(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
            c.pem, '-----BEGIN CERTIFICATE-----', ''), '-----END CERTIFICATE-----', ''),
            CHAR(13), ''), CHAR(10), ''), ' ', '')), 512)
          = LOWER(o.client_cert_fingerprint)
    LIMIT 1),
  'MIGRATED', 'migration-029', NOW(3)
FROM organizations o
WHERE o.client_cert_fingerprint IS NOT NULL AND o.client_cert_fingerprint <> '';
