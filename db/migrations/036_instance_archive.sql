-- 036_instance_archive.sql
--
-- An instance owner can archive an instance they no longer work on:
--
--   instances.archived_at   set while the instance is archived; NULL otherwise.
--                           An archived instance is hidden from the owner's
--                           instance list and dashboard by default. Its data,
--                           its approval history and the organization's
--                           membership of the published allow list are not
--                           touched: archiving never withdraws a site.
--   instances.archived_by   e-mail of the user who archived it.
--
-- Idempotent: information_schema + PREPARE/EXECUTE; safe to re-run.

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'instances' AND COLUMN_NAME = 'archived_at');
SET @sql := IF(@c = 0,
  'ALTER TABLE instances ADD COLUMN archived_at DATETIME NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'instances' AND COLUMN_NAME = 'archived_by');
SET @sql := IF(@c = 0,
  'ALTER TABLE instances ADD COLUMN archived_by VARCHAR(255) NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
