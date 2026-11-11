-- 037_incident_nis2_reports.sql
--
-- NIS2 reporting aids of an incident (BSIG 32). The portal does not report to
-- the BSI; it holds the content of each report as a form filling aid:
--
--   incidents.nis2_data                  JSON: the structured fields per stage
--                                        (early warning, notification, final /
--                                        progress report). A stage can only be
--                                        ticked as reported when its fields
--                                        are filled.
--   incidents.bsi_interim_requested_at   the BSI asked for an interim report
--   incidents.bsi_interim_requested_by   (Zwischenmeldung) on this date; set
--                                        by an admin or the affected site.
--   incidents.bsi_interim_at / _by       interim report ticked as reported.
--   incidents.bsi_progress_at / _by      progress report (Fortschrittsmeldung)
--                                        ticked as reported; due when the
--                                        final report falls due while the
--                                        incident is not closed, after which
--                                        the final report is due one month
--                                        after the incident is closed.
--
-- incidents.detected_at is labelled "became aware at" (Kenntnis erlangt am)
-- in the UI; the column keeps its name.
--
-- Idempotent: information_schema + PREPARE/EXECUTE; safe to re-run.

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'incidents' AND COLUMN_NAME = 'nis2_data');
SET @sql := IF(@c = 0,
  'ALTER TABLE incidents ADD COLUMN nis2_data JSON NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'incidents' AND COLUMN_NAME = 'bsi_interim_requested_at');
SET @sql := IF(@c = 0,
  'ALTER TABLE incidents ADD COLUMN bsi_interim_requested_at DATETIME(3) NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'incidents' AND COLUMN_NAME = 'bsi_interim_requested_by');
SET @sql := IF(@c = 0,
  'ALTER TABLE incidents ADD COLUMN bsi_interim_requested_by VARCHAR(255) NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'incidents' AND COLUMN_NAME = 'bsi_interim_at');
SET @sql := IF(@c = 0,
  'ALTER TABLE incidents ADD COLUMN bsi_interim_at DATETIME(3) NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'incidents' AND COLUMN_NAME = 'bsi_interim_by');
SET @sql := IF(@c = 0,
  'ALTER TABLE incidents ADD COLUMN bsi_interim_by VARCHAR(255) NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'incidents' AND COLUMN_NAME = 'bsi_progress_at');
SET @sql := IF(@c = 0,
  'ALTER TABLE incidents ADD COLUMN bsi_progress_at DATETIME(3) NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'incidents' AND COLUMN_NAME = 'bsi_progress_by');
SET @sql := IF(@c = 0,
  'ALTER TABLE incidents ADD COLUMN bsi_progress_by VARCHAR(255) NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
