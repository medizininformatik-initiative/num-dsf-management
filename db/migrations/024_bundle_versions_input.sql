-- 024_bundle_versions_input.sql
--
-- Every bundle version also stores the serialized builder input of the network
-- state it was built from (members, withdrawn organizations, parent names).
-- With it any receiver view of any version can be rebuilt later: the DSF
-- allow-list process reads the current version and its history per endpoint,
-- and an admin can restore an old version. Versions created before this
-- migration keep input_json NULL and are not restorable.
--
-- Idempotent: information_schema + PREPARE/EXECUTE, safe to re-run.

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'bundle_versions'
    AND COLUMN_NAME = 'input_json'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE bundle_versions ADD COLUMN input_json LONGTEXT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
