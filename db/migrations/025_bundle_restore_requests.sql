-- 025_bundle_restore_requests.sql
--
-- Restoring an old allow-list version is a four-eyes decision: one admin
-- requests it, a second admin from a different site approves or rejects it.
-- The request references the source version; on approval the new (RESTORE)
-- version is recorded in resulting_version_id. pending_slot is 1 while the
-- request is PENDING and NULL afterwards; its UNIQUE key allows only one
-- pending request at a time, even under concurrent requests.
--
-- Idempotent: information_schema + PREPARE/EXECUTE, safe to re-run.

SET @t := (SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bundle_restore_requests');
SET @sql := IF(@t = 0,
  'CREATE TABLE bundle_restore_requests (
     id                    CHAR(36) PRIMARY KEY,
     source_version_id     CHAR(36) NOT NULL,
     reason                VARCHAR(500) NOT NULL,
     requested_by          VARCHAR(255) NOT NULL,
     requested_at          DATETIME(3) NOT NULL,
     status                ENUM("PENDING","APPROVED","REJECTED","CANCELLED") NOT NULL DEFAULT "PENDING",
     decided_by            VARCHAR(255) NULL,
     decided_at            DATETIME(3) NULL,
     decision_comment      TEXT NULL,
     resulting_version_id  CHAR(36) NULL,
     pending_slot          TINYINT AS (IF(status = "PENDING", 1, NULL)) STORED,
     UNIQUE KEY uq_brr_one_pending (pending_slot),
     KEY idx_brr_requested (requested_at),
     CONSTRAINT fk_brr_source FOREIGN KEY (source_version_id) REFERENCES bundle_versions (id) ON DELETE CASCADE
   ) ENGINE=InnoDB',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
