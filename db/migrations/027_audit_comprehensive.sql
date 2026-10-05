-- 027_audit_comprehensive.sql
--
-- Audit log: record security-relevant events that were not captured so far and
-- index the filter columns of the audit views.
--   operation     += DENIED          authorization / policy refusal (private key
--                                    upload, CA refused, four-eyes violation)
--                    STEP_UP_FAILED  failed admin step-up re-verification
--                    RATE_LIMITED    an auth / step-up rate limit was hit
--                    EXPORT          an audit-log export was downloaded
--   resource_type += AUDIT
--
-- Additive and idempotent: each value is appended to the CURRENT column type
-- only when missing, so values added by other migrations (e.g. a withdraw
-- operation) are preserved and re-running is a no-op. Rows are never touched
-- (audit_logs is append-only, see 013).

SET @t := (SELECT COLUMN_TYPE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'operation');
SET @sql := IF(@t LIKE '%''DENIED''%', 'SELECT 1',
  CONCAT('ALTER TABLE audit_logs MODIFY COLUMN operation ', LEFT(@t, CHAR_LENGTH(@t) - 1), ',''DENIED'') NOT NULL'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @t := (SELECT COLUMN_TYPE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'operation');
SET @sql := IF(@t LIKE '%''STEP_UP_FAILED''%', 'SELECT 1',
  CONCAT('ALTER TABLE audit_logs MODIFY COLUMN operation ', LEFT(@t, CHAR_LENGTH(@t) - 1), ',''STEP_UP_FAILED'') NOT NULL'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @t := (SELECT COLUMN_TYPE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'operation');
SET @sql := IF(@t LIKE '%''RATE_LIMITED''%', 'SELECT 1',
  CONCAT('ALTER TABLE audit_logs MODIFY COLUMN operation ', LEFT(@t, CHAR_LENGTH(@t) - 1), ',''RATE_LIMITED'') NOT NULL'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @t := (SELECT COLUMN_TYPE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'operation');
SET @sql := IF(@t LIKE '%''EXPORT''%', 'SELECT 1',
  CONCAT('ALTER TABLE audit_logs MODIFY COLUMN operation ', LEFT(@t, CHAR_LENGTH(@t) - 1), ',''EXPORT'') NOT NULL'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @t := (SELECT COLUMN_TYPE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'resource_type');
SET @sql := IF(@t LIKE '%''AUDIT''%', 'SELECT 1',
  CONCAT('ALTER TABLE audit_logs MODIFY COLUMN resource_type ', LEFT(@t, CHAR_LENGTH(@t) - 1), ',''AUDIT'') NOT NULL'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @i := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_logs' AND INDEX_NAME = 'idx_al_op');
SET @sql := IF(@i = 0, 'CREATE INDEX idx_al_op ON audit_logs (operation, timestamp)', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @i := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_logs' AND INDEX_NAME = 'idx_al_inst_time');
SET @sql := IF(@i = 0, 'CREATE INDEX idx_al_inst_time ON audit_logs (instance_id, timestamp)', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @i := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_logs' AND INDEX_NAME = 'idx_al_ip');
SET @sql := IF(@i = 0, 'CREATE INDEX idx_al_ip ON audit_logs (ip_address)', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
