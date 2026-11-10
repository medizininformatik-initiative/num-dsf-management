-- 035_incidents.sql
--
-- Incident register: a compromised site is reported, confirmed, suspended and
-- recorded in one place.
--
--   incidents                         one row per reported incident. status
--                                     REPORTED -> CONFIRMED -> CLOSED, or
--                                     FALSE_ALARM. suspended = 1 while the
--                                     affected organization is suspended by
--                                     this incident (published as withdrawn,
--                                     no login). escalation_level 1/2/3,
--                                     detected_at starts the NIS2 deadlines
--                                     (24 h / 72 h / 1 month); the bsi_* and
--                                     dpo_* columns record who ticked "reported
--                                     to BSI" per stage and "DPO informed".
--                                     reported_by_instance_id is set when the
--                                     report came through an organization
--                                     certificate session (scoped to that
--                                     instance; reported_by is then the
--                                     instance owner's e-mail), so such a
--                                     session is a different reporter than the
--                                     owner's own login.
--                                     Incidents are never deleted.
--   incident_events                   append-only timeline of an incident
--                                     (no UPDATE/DELETE in code, same rule as
--                                     audit_logs). details holds the measures
--                                     and their results. seq orders the events
--                                     of one incident; hash = SHA-256 over
--                                     prev_hash + the canonical event content,
--                                     so the timeline is a verifiable chain.
--   blocked_certificate_thumbprints   SHA-512 thumbprints blocked by an
--                                     incident: never uploaded again by any
--                                     organization, never a login certificate.
--                                     Rows are never deleted.
--   audit_logs.resource_type          += INCIDENT
--
-- Idempotent: information_schema + PREPARE/EXECUTE; safe to re-run.

-- incidents.organization_id references organizations.identifier, so it takes
-- that column's character set and collation (a foreign key needs both equal,
-- and older databases created organizations with utf8mb4_unicode_ci while the
-- server default is utf8mb4_0900_ai_ci; see migration 031).
SET @org_cs := (SELECT CONCAT('CHARACTER SET ', CHARACTER_SET_NAME, ' COLLATE ', COLLATION_NAME)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'organizations' AND COLUMN_NAME = 'identifier');
SET @t := (SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'incidents');
SET @sql := IF(@t = 0, CONCAT(
  'CREATE TABLE incidents (
     id               CHAR(36)      NOT NULL PRIMARY KEY,
     organization_id  VARCHAR(255)  ', @org_cs, ' NULL,
     title            VARCHAR(200)  NOT NULL,
     description      TEXT          NOT NULL,
     status           ENUM("REPORTED","CONFIRMED","CLOSED","FALSE_ALARM") NOT NULL DEFAULT "REPORTED",
     reported_by      VARCHAR(255)  NOT NULL,
     reported_by_instance_id CHAR(36) NULL,
     reported_at      DATETIME(3)   NOT NULL,
     detected_at      DATETIME(3)   NOT NULL,
     escalation_level TINYINT       NOT NULL DEFAULT 1,
     zulip_url        VARCHAR(500)  NULL,
     confirmed_by     VARCHAR(255)  NULL,
     confirmed_at     DATETIME(3)   NULL,
     closed_by        VARCHAR(255)  NULL,
     closed_at        DATETIME(3)   NULL,
     suspended        TINYINT(1)    NOT NULL DEFAULT 0,
     bsi_early_warning_at   DATETIME(3)  NULL,
     bsi_early_warning_by   VARCHAR(255) NULL,
     bsi_notification_at    DATETIME(3)  NULL,
     bsi_notification_by    VARCHAR(255) NULL,
     bsi_final_report_at    DATETIME(3)  NULL,
     bsi_final_report_by    VARCHAR(255) NULL,
     dpo_informed_at        DATETIME(3)  NULL,
     dpo_informed_by        VARCHAR(255) NULL,
     KEY idx_incidents_status (status, reported_at),
     KEY idx_incidents_org (organization_id, suspended),
     CONSTRAINT fk_incidents_org FOREIGN KEY (organization_id) REFERENCES organizations (identifier) ON DELETE SET NULL
   ) ENGINE=InnoDB'),
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Databases that ran an earlier draft of this migration lack the column.
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'incidents' AND COLUMN_NAME = 'reported_by_instance_id');
SET @sql := IF(@c = 0,
  'ALTER TABLE incidents ADD COLUMN reported_by_instance_id CHAR(36) NULL AFTER reported_by',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @t := (SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'incident_events');
SET @sql := IF(@t = 0,
  'CREATE TABLE incident_events (
     id           CHAR(36)      NOT NULL PRIMARY KEY,
     incident_id  CHAR(36)      NOT NULL,
     seq          INT           NOT NULL,
     at           DATETIME(3)   NOT NULL,
     actor_email  VARCHAR(255)  NOT NULL,
     type         ENUM("REPORTED","CONFIRMED","SUSPENDED","MEASURE","COMMENT","SUSPENSION_LIFTED","CLOSED","FALSE_ALARM","UPDATED") NOT NULL,
     details      JSON          NULL,
     prev_hash    CHAR(64)      NOT NULL,
     hash         CHAR(64)      NOT NULL,
     UNIQUE KEY uq_incident_events_seq (incident_id, seq),
     CONSTRAINT fk_incident_events_incident FOREIGN KEY (incident_id) REFERENCES incidents (id)
   ) ENGINE=InnoDB',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @t := (SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'blocked_certificate_thumbprints');
SET @sql := IF(@t = 0,
  'CREATE TABLE blocked_certificate_thumbprints (
     fingerprint  CHAR(128)     NOT NULL PRIMARY KEY,
     incident_id  CHAR(36)      NOT NULL,
     created_by   VARCHAR(255)  NOT NULL,
     created_at   DATETIME(3)   NOT NULL,
     KEY idx_bct_incident (incident_id),
     CONSTRAINT fk_bct_incident FOREIGN KEY (incident_id) REFERENCES incidents (id)
   ) ENGINE=InnoDB',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- audit_logs.resource_type += 'INCIDENT'
SET @ct := (SELECT COLUMN_TYPE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'resource_type');
SET @sql := IF(@ct IS NOT NULL AND @ct NOT LIKE '%''INCIDENT''%',
  CONCAT('ALTER TABLE audit_logs MODIFY COLUMN resource_type ',
         SUBSTRING(@ct, 1, CHAR_LENGTH(@ct) - 1), ',''INCIDENT'') NOT NULL'),
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
