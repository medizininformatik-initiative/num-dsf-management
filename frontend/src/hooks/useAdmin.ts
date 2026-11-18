/**
 * useAdmin.ts – React Query hooks for admin approval management and the
 * CA whitelist / blacklist lists of the admin CA page.
 * Dependencies: admin.api, caWhitelist.api, caBlacklist.api, tanstack/react-query
 */
import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { adminApi, type AdminStats, type PendingRequest } from '../api/admin.api';
import { caWhitelistApi } from '../api/caWhitelist.api';
import { caBlacklistApi } from '../api/caBlacklist.api';

/** Query keys of the CA lists; mutations invalidate them after a write. */
export const CA_WHITELIST_KEY = ['ca-whitelist'] as const;
export const CA_BLACKLIST_KEY = ['ca-blacklist'] as const;

/** The CA whitelist and whether it is enforced on certificate upload. */
export function useCaWhitelist() {
  return useQuery({
    queryKey: CA_WHITELIST_KEY,
    queryFn: () => caWhitelistApi.list().then((r) => r.data.data),
  });
}

/** The CA blacklist plus the known (Mozilla) CAs offered as DN suggestions. */
export function useCaBlacklist() {
  return useQuery({
    queryKey: CA_BLACKLIST_KEY,
    queryFn: () => caBlacklistApi.list().then((r) => r.data.data),
  });
}

// A decision regenerates the published bundle and flips one instance's approval
// state, but the hook has no instanceId; invalidate approval keys by prefix so
// every instance refreshes (v5 invalidateQueries is prefix-matching by default).
function invalidateAfterDecision(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['admin', 'pending-approvals'] });
  qc.invalidateQueries({ queryKey: ['network', 'map'] });
  qc.invalidateQueries({ queryKey: ['approval-status'] });
  qc.invalidateQueries({ queryKey: ['approval-history'] });
}

/** Summary numbers for the admin overview tiles. */
export function useAdminStats() {
  return useQuery<AdminStats>({
    queryKey: ['admin', 'stats'],
    queryFn: () => adminApi.getStats().then((r) => r.data.data),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

export function usePendingApprovals(enabled = true) {
  return useQuery<PendingRequest[]>({
    enabled,
    queryKey: ['admin', 'pending-approvals'],
    queryFn: () => adminApi.getPendingApprovals().then((r) => r.data.data),
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}

export function useApproveRequest() {
  const qc = useQueryClient();
  return useMutation<
    { data: { status: 'PENDING' | 'APPROVED'; reason?: string } },
    Error,
    { requestId: string; totpCode?: string }
  >({
    mutationFn: ({ requestId, totpCode }) =>
      adminApi.approveRequest(requestId, totpCode).then((r) => r.data),
    onSuccess: () => invalidateAfterDecision(qc),
  });
}

export function useRejectRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      requestId,
      comment,
      totpCode,
    }: {
      requestId: string;
      comment: string;
      totpCode?: string;
    }) => adminApi.rejectRequest(requestId, comment, totpCode),
    onSuccess: () => invalidateAfterDecision(qc),
  });
}
