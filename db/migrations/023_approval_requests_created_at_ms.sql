-- 023_approval_requests_created_at_ms.sql
--
-- Millisecond precision for approval_requests.created_at. The allow list and
-- the approval status take an instance's latest request by created_at; with
-- whole seconds, a request created in the same second as the previous one
-- tied with it, and the tie-break on the random UUID made the "latest"
-- request arbitrary (seen when a site withdrew right after an approval).
--
-- Idempotent: modifying the column to the same definition again is a no-op.

ALTER TABLE `approval_requests`
  MODIFY `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);
