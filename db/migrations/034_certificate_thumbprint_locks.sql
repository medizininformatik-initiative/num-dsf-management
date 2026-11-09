-- 034_certificate_thumbprint_locks.sql
--
-- A certificate belongs to one organization. Uploading or renewing checks that
-- no other organization holds the thumbprint; that check and the insert must be
-- atomic, or two organizations uploading the same PEM at once both pass.
--
--   certificate_thumbprint_locks  one row per SHA-256 thumbprint ever uploaded.
--                                 The upload/renewal transaction inserts the
--                                 row (INSERT IGNORE) and locks it FOR UPDATE
--                                 before the check, so registrations of the
--                                 same thumbprint run one after the other.
--                                 The row carries no ownership; it is only the
--                                 lock and is never deleted.
--
-- A unique index on certificates.thumbprint is not used: the same organization
-- may upload the same certificate more than once.
--
-- Idempotent: information_schema + PREPARE/EXECUTE; safe to re-run.

SET @t := (SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'certificate_thumbprint_locks');
SET @sql := IF(@t = 0,
  'CREATE TABLE certificate_thumbprint_locks (
     thumbprint  VARCHAR(64) NOT NULL PRIMARY KEY
   ) ENGINE=InnoDB',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
