-- 032_allowlist_fetches.sql
--
-- Remembers, per instance (site), the newest allow-list version it has
-- obtained, either through its DSF (mTLS fetch of the receiver bundle) or
-- through a download in the portal. The portal compares it with the current
-- bundle version to nudge a site that has not picked up a new allow list yet.
-- One row per instance, upserted by the application; the version number never
-- decreases. No personal data.
--
-- Idempotent: information_schema + PREPARE/EXECUTE, safe to re-run.

SET @t := (SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'allowlist_fetches');
SET @sql := IF(@t = 0,
  'CREATE TABLE allowlist_fetches (
     instance_id     CHAR(36)    NOT NULL PRIMARY KEY,
     version_number  INT         NOT NULL,
     via             ENUM("DSF","PORTAL") NOT NULL,
     fetched_at      DATETIME(3) NOT NULL,
     CONSTRAINT fk_alf_instance FOREIGN KEY (instance_id) REFERENCES instances (id) ON DELETE CASCADE
   ) ENGINE=InnoDB',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
