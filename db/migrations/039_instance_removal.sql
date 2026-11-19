-- 039_instance_removal.sql
--
-- Removing a whole site (instance) needs two admins from different e-mail
-- domains (four-eyes, same rule as the approval of a request):
--
--   instance_removal_requests   admin A requests the removal with a reason, admin
--                               B (other domain, not A) confirms; A may cancel
--                               while it is PENDING. At most one PENDING request
--                               per instance (pending_instance is unique).
--                               version_number is the allow-list version that was
--                               published when the removal was executed (NULL when
--                               publishing failed and has to be done by hand).
--   instances.removed_at        set when the removal was executed; the site is then
--   instances.removed_by        withdrawn from the allow list (conditional DELETEs
--                               for its Organization, Endpoints and affiliations in
--                               the next version), cannot log in and cannot be
--                               selected. No row is deleted (soft removal).
--   audit_logs.operation        unchanged: request/confirm/cancel are audited as
--                               AUTH CREATE / DELETE / UPDATE with diff_json.action.
--
-- Idempotent: information_schema + PREPARE/EXECUTE; safe to re-run.

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'instances' AND COLUMN_NAME = 'removed_at');
SET @sql := IF(@c = 0,
  'ALTER TABLE instances ADD COLUMN removed_at DATETIME(3) NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'instances' AND COLUMN_NAME = 'removed_by');
SET @sql := IF(@c = 0,
  'ALTER TABLE instances ADD COLUMN removed_by VARCHAR(255) NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- instance_id is compared with instances.id: same character set and collation
-- (see migration 031/035 for the older-database collation difference).
SET @inst_cs := (SELECT CONCAT('CHARACTER SET ', CHARACTER_SET_NAME, ' COLLATE ', COLLATION_NAME)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'instances' AND COLUMN_NAME = 'id');
SET @t := (SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'instance_removal_requests');
SET @sql := IF(@t = 0, CONCAT(
  'CREATE TABLE instance_removal_requests (
     id               CHAR(36)     NOT NULL PRIMARY KEY,
     instance_id      CHAR(36)     ', @inst_cs, ' NOT NULL,
     organization_id  VARCHAR(255) NULL,
     reason           TEXT         NOT NULL,
     requested_by     VARCHAR(255) NOT NULL,
     requested_at     DATETIME(3)  NOT NULL,
     status           ENUM("PENDING","CONFIRMED","CANCELLED") NOT NULL DEFAULT "PENDING",
     decided_by       VARCHAR(255) NULL,
     decided_at       DATETIME(3)  NULL,
     version_number   INT          NULL,
     pending_instance CHAR(36)     ', @inst_cs, ' AS (IF(status = "PENDING", instance_id, NULL)) STORED,
     UNIQUE KEY uq_irr_one_pending (pending_instance),
     KEY idx_irr_status (status, requested_at),
     KEY idx_irr_instance (instance_id)
   ) ENGINE=InnoDB'),
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
