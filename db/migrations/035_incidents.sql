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

SET @t := (SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'incidents');
SET @sql := IF(@t = 0,
  'CREATE TABLE incidents (
     id               CHAR(36)      NOT NULL PRIMARY KEY,
     organization_id  VARCHAR(255)  NULL,
     title            VARCHAR(200)  NOT NULL,
     description      TEXT          NOT NULL,
     status           ENUM("REPORTED","CONFIRMED","CLOSED","FALSE_ALARM") NOT NULL DEFAULT "REPORTED",
     reported_by      VARCHAR(255)  NOT NULL,
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
   ) ENGINE=InnoDB',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

