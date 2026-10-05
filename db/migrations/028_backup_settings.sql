-- 028_backup_settings.sql
--
-- Full application backup: the admin-configurable schedule (single row,
-- id = 1), a log of every backup run (scheduled or manual), and the audit_logs
-- ENUM values the backup feature writes.
--
--   backup_settings  enabled flag, interval mode (EVERY_6H, EVERY_12H, or DAILY
--                    at daily_time Europe/Berlin; never less often than
--                    daily) and retention_count (keep the last N files, 7..365).
--   backup_runs      one row per attempt: file name, size, SHA-256 of the file,
--                    duration, status and error. Pruned files keep their row
--                    with file_deleted = 1.
--   audit_logs       resource_type gains 'BACKUP', operation gains 'DOWNLOAD'.
--                    The new values are appended to the ENUM as it stands in
--                    the live database, so values added by other migrations
--                    are preserved.
--
-- Idempotent: information_schema + PREPARE/EXECUTE, safe to re-run.

SET @t := (SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'backup_settings');
SET @sql := IF(@t = 0,
  'CREATE TABLE backup_settings (
     id               TINYINT      NOT NULL PRIMARY KEY,
     enabled          TINYINT(1)   NOT NULL DEFAULT 1,
     mode             ENUM("EVERY_6H","EVERY_12H","DAILY") NOT NULL DEFAULT "DAILY",
     daily_time       CHAR(5)      NOT NULL DEFAULT "02:30",
     retention_count  INT          NOT NULL DEFAULT 14,
     updated_by       VARCHAR(255) NULL,
     updated_at       DATETIME(3)  NULL,
     CONSTRAINT chk_backup_single_row CHECK (id = 1),
     CONSTRAINT chk_backup_retention CHECK (retention_count BETWEEN 7 AND 365)
   ) ENGINE=InnoDB',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

INSERT IGNORE INTO backup_settings (id, enabled, mode, daily_time, retention_count)
VALUES (1, 1, 'DAILY', '02:30', 14);

SET @t := (SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'backup_runs');
SET @sql := IF(@t = 0,
  'CREATE TABLE backup_runs (
     id            CHAR(36)     NOT NULL PRIMARY KEY,
     started_at    DATETIME(3)  NOT NULL,
     finished_at   DATETIME(3)  NOT NULL,
     trigger_type  ENUM("SCHEDULED","MANUAL") NOT NULL,
     triggered_by  VARCHAR(255) NULL,
     status        ENUM("SUCCESS","FAILED") NOT NULL,
     file_name     VARCHAR(255) NULL,
     size_bytes    BIGINT       NULL,
     sha256        CHAR(64)     NULL,
     encrypted     TINYINT(1)   NOT NULL DEFAULT 0,
     duration_ms   INT          NOT NULL,
     error         VARCHAR(1000) NULL,
     file_deleted  TINYINT(1)   NOT NULL DEFAULT 0,
     KEY idx_backup_runs_started (started_at)
   ) ENGINE=InnoDB',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- audit_logs.resource_type += 'BACKUP'
SET @ct := (SELECT COLUMN_TYPE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'resource_type');
SET @sql := IF(@ct IS NOT NULL AND @ct NOT LIKE '%''BACKUP''%',
  CONCAT('ALTER TABLE audit_logs MODIFY COLUMN resource_type ',
         SUBSTRING(@ct, 1, CHAR_LENGTH(@ct) - 1), ',''BACKUP'') NOT NULL'),
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- audit_logs.operation += 'DOWNLOAD'
SET @ct := (SELECT COLUMN_TYPE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'operation');
SET @sql := IF(@ct IS NOT NULL AND @ct NOT LIKE '%''DOWNLOAD''%',
  CONCAT('ALTER TABLE audit_logs MODIFY COLUMN operation ',
         SUBSTRING(@ct, 1, CHAR_LENGTH(@ct) - 1), ',''DOWNLOAD'') NOT NULL'),
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
