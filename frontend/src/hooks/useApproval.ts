/**
 * useApproval.ts — TanStack Query hooks for approval status, history, and submission,
 * plus the shapes the approval endpoints return.
 * Wraps the entities API; a submit refreshes approval-status and approval-history
 * whether it succeeds or fails (a refused submit usually means the cached status is stale).
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/entities.api';

export type ApprovalStatusValue = 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED';

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
