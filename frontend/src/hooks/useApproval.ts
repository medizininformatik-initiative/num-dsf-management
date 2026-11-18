/**
 * useApproval.ts — TanStack Query hooks for approval status, history, submission and withdrawal,
 * plus the shapes the approval endpoints return.
 * Wraps the entities API; a submit refreshes approval-status and approval-history
 * whether it succeeds or fails (a refused submit usually means the cached status is stale).
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/entities.api';

export type ApprovalStatusValue = 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';

/** One approval request as GET /approval/history lists it (newest first, max. 20). */
export interface ApprovalRequest {
  id: string;
  status: ApprovalStatusValue;
  created_at: string;
  submitted_at: string | null;
  resolved_at: string | null;
  /** Reviewer e-mail, or SYSTEM:silent-consent for an automatic approval. */
  resolved_by: string | null;
  /** Rejection reason. */
  comment: string | null;
  /** Sorted IPs of the request's snapshot; null when the snapshot is unreadable. */
  approved_ips?: string[] | null;
}

/** Four-eyes progress of the latest request. */
export interface FourEyes {
  approvals: number;
  required: number;
  /** When a single approval becomes final by silent consent, unless someone rejects. */
  silentConsentAt: string | null;
}

/** GET /approval/status: the latest request plus its four-eyes progress, or null. */
export interface ApprovalStatus extends ApprovalRequest {
  fourEyes?: FourEyes;
  /** E-mail of the user who submitted the request (from the audit log; may be missing). */
  submitted_by?: string | null;
  /** Data snapshot the request was sent with (JSON string or parsed object). */
  snapshot_json?: string | object | null;
  /** False when the data equals the last approved snapshot; null/undefined when unknown. */
  changedSinceApproval?: boolean | null;
}

export function useApprovalStatus(instanceId: string | null) {
  return useQuery({
    queryKey: ['approval-status', instanceId],
    queryFn: () =>
      api(instanceId!)
        .getApprovalStatus()
        .then((r) => r.data.data),
    enabled: !!instanceId,
    staleTime: 30_000,
  });
}

export function useApprovalHistory(instanceId: string | null) {
  return useQuery({
    queryKey: ['approval-history', instanceId],
    queryFn: () =>
      api(instanceId!)
        .getApprovalHistory()
        .then((r) => r.data.data),
    enabled: !!instanceId,
    staleTime: 30_000,
  });
}

export function useSubmitApproval(instanceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api(instanceId).submitApproval(),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['approval-status', instanceId] });
      qc.invalidateQueries({ queryKey: ['approval-history', instanceId] });
    },
  });
}

/** Take the PENDING request back; refreshes status and history either way (a 409 means it was decided meanwhile). */
export function useWithdrawApproval(instanceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api(instanceId).withdrawApproval(),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['approval-status', instanceId] });
      qc.invalidateQueries({ queryKey: ['approval-history', instanceId] });
    },
  });
}
