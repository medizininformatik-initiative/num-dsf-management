-- 026_approval_withdrawn.sql
-- A site can withdraw its own PENDING approval request.
--   * approval_requests.status gains WITHDRAWN (terminal, like REJECTED).
--   * audit_logs.operation gains WITHDRAW so the withdrawal is traceable.
--
-- Idempotent: MODIFY COLUMN to the same definition again is a no-op, and the
-- new values are appended at the end so existing rows keep their ordinals.

ALTER TABLE `approval_requests`
  MODIFY COLUMN `status`
  ENUM('DRAFT','PENDING','APPROVED','REJECTED','WITHDRAWN') NOT NULL DEFAULT 'DRAFT';

ALTER TABLE `audit_logs`
  MODIFY COLUMN `operation`
  ENUM('CREATE','UPDATE','DELETE','APPROVE','REJECT','LOGIN','LOGOUT','OTP_REQUEST','OTP_VERIFY','TOTP_SETUP','TOTP_VERIFY','FAILED_LOGIN','WITHDRAW') NOT NULL;
