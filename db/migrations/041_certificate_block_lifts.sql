-- 041_certificate_block_lifts.sql
--
-- Lifting the certificate blocks of an incident that turned out to be a false
-- alarm, with two admins of different e-mail domains (four-eyes):
--
--   certificate_block_lift_requests   admin A requests "lift blocks" for a
--                                     FALSE_ALARM incident (reason), admin B
--                                     confirms; A may cancel while PENDING. At
--                                     most one PENDING request per incident
--                                     (pending_incident is unique).
--   certificate_block_lifts           the final, append-only record: one row
--                                     per (fingerprint, incident) whose block
--                                     was lifted, with who requested and who
--                                     confirmed it and why. UPDATE and DELETE
--                                     are forbidden by triggers (like
--                                     blocked_certificate_thumbprints).
--   blocked_certificate_thumbprints   rows stay for good. A block is effective
--                                     only while no lift exists for its
--                                     (fingerprint, incident). The primary key
--                                     becomes (fingerprint, incident_id), so a
--                                     later incident can block a lifted
--                                     thumbprint again.
--   incident_events.type              += BLOCK_LIFT_REQUESTED, BLOCKS_LIFTED
--
-- Idempotent: information_schema + PREPARE/EXECUTE; safe to re-run.

-- Primary key (fingerprint) -> (fingerprint, incident_id).
SET @pk_cols := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'blocked_certificate_thumbprints'
    AND INDEX_NAME = 'PRIMARY');
SET @sql := IF(@pk_cols = 1,
  'ALTER TABLE blocked_certificate_thumbprints DROP PRIMARY KEY, ADD PRIMARY KEY (fingerprint, incident_id)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- The new tables take the character set and collation of the columns they are
-- compared with (see migrations 031 and 035).
SET @fp_cs := (SELECT CONCAT('CHARACTER SET ', CHARACTER_SET_NAME, ' COLLATE ', COLLATION_NAME)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'blocked_certificate_thumbprints' AND COLUMN_NAME = 'fingerprint');
SET @inc_cs := (SELECT CONCAT('CHARACTER SET ', CHARACTER_SET_NAME, ' COLLATE ', COLLATION_NAME)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'incidents' AND COLUMN_NAME = 'id');

SET @t := (SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'certificate_block_lift_requests');
SET @sql := IF(@t = 0, CONCAT(
  'CREATE TABLE certificate_block_lift_requests (
     id               CHAR(36)     NOT NULL PRIMARY KEY,
     incident_id      CHAR(36)     ', @inc_cs, ' NOT NULL,
     reason           TEXT         NOT NULL,
     requested_by     VARCHAR(255) NOT NULL,
     requested_at     DATETIME(3)  NOT NULL,
     status           ENUM("PENDING","CONFIRMED","CANCELLED") NOT NULL DEFAULT "PENDING",
     decided_by       VARCHAR(255) NULL,
     decided_at       DATETIME(3)  NULL,
     pending_incident CHAR(36)     ', @inc_cs, ' AS (IF(status = "PENDING", incident_id, NULL)) STORED,
     UNIQUE KEY uq_cblr_one_pending (pending_incident),
     KEY idx_cblr_incident (incident_id, requested_at),
     CONSTRAINT fk_cblr_incident FOREIGN KEY (incident_id) REFERENCES incidents (id)
   ) ENGINE=InnoDB'),
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @t := (SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'certificate_block_lifts');
SET @sql := IF(@t = 0, CONCAT(
  'CREATE TABLE certificate_block_lifts (
     id            CHAR(36)     NOT NULL PRIMARY KEY,
     fingerprint   CHAR(128)    ', @fp_cs, ' NOT NULL,
     incident_id   CHAR(36)     ', @inc_cs, ' NOT NULL,
     request_id    CHAR(36)     NOT NULL,
     requested_by  VARCHAR(255) NOT NULL,
     requested_at  DATETIME(3)  NOT NULL,
     confirmed_by  VARCHAR(255) NOT NULL,
     confirmed_at  DATETIME(3)  NOT NULL,
     reason        TEXT         NOT NULL,
     UNIQUE KEY uq_cbl_fingerprint_incident (fingerprint, incident_id),
     KEY idx_cbl_incident (incident_id),
     CONSTRAINT fk_cbl_incident FOREIGN KEY (incident_id) REFERENCES incidents (id)
   ) ENGINE=InnoDB'),
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- incident_events.type += 'BLOCK_LIFT_REQUESTED', 'BLOCKS_LIFTED'
SET @ct := (SELECT COLUMN_TYPE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'incident_events' AND COLUMN_NAME = 'type');
SET @sql := IF(@ct IS NOT NULL AND @ct NOT LIKE '%''BLOCKS_LIFTED''%',
  CONCAT('ALTER TABLE incident_events MODIFY COLUMN type ',
         SUBSTRING(@ct, 1, CHAR_LENGTH(@ct) - 1),
         ',''BLOCK_LIFT_REQUESTED'',''BLOCKS_LIFTED'') NOT NULL'),
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- certificate_block_lifts is append-only at the DB level, like audit_logs
-- (migration 013) and blocked_certificate_thumbprints (035). The backup
-- restore drops and re-creates the triggers of the tables it restores.
DELIMITER //

DROP TRIGGER IF EXISTS `certificate_block_lifts_no_update`//
CREATE TRIGGER `certificate_block_lifts_no_update`
BEFORE UPDATE ON `certificate_block_lifts`
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'certificate_block_lifts is append-only; UPDATE is not permitted';
END//

DROP TRIGGER IF EXISTS `certificate_block_lifts_no_delete`//
CREATE TRIGGER `certificate_block_lifts_no_delete`
BEFORE DELETE ON `certificate_block_lifts`
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'certificate_block_lifts is append-only; DELETE is not permitted';
END//

DELIMITER ;
