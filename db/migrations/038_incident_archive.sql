-- 038_incident_archive.sql
--
-- Archiving (soft delete) of incidents, e.g. false alarms:
--
--   incidents.archived_at   when an admin archived the incident; NULL = active.
--   incidents.archived_by   e-mail of that admin.
--   incident_events.type    += ARCHIVED (the timeline records the archiving).
--
-- Only a FALSE_ALARM or CLOSED incident that no longer suspends a site can be
-- archived. Archived incidents drop out of the default lists and counters; no
-- row is deleted and the blocked thumbprints stay as they are.
--
-- Idempotent: information_schema + PREPARE/EXECUTE; safe to re-run.

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'incidents' AND COLUMN_NAME = 'archived_at');
SET @sql := IF(@c = 0,
  'ALTER TABLE incidents ADD COLUMN archived_at DATETIME(3) NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'incidents' AND COLUMN_NAME = 'archived_by');
SET @sql := IF(@c = 0,
  'ALTER TABLE incidents ADD COLUMN archived_by VARCHAR(255) NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- incident_events.type += 'ARCHIVED'
SET @ct := (SELECT COLUMN_TYPE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'incident_events' AND COLUMN_NAME = 'type');
SET @sql := IF(@ct IS NOT NULL AND @ct NOT LIKE '%''ARCHIVED''%',
  CONCAT('ALTER TABLE incident_events MODIFY COLUMN type ',
         SUBSTRING(@ct, 1, CHAR_LENGTH(@ct) - 1), ',''ARCHIVED'') NOT NULL'),
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
