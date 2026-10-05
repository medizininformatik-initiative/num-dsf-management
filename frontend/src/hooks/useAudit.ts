/**
 * useAudit.ts – TanStack Query hooks for the cross-instance audit log
 * (filtered list with anomaly flags, site list for the site filter).
 * Dependencies: @tanstack/react-query, audit.api
 */
import { useQuery } from '@tanstack/react-query';
import { getAuditSites, getCrossInstanceAudit, type AuditFilters } from '../api/audit.api';

export function useCrossInstanceAudit(
  page: number = 1,
  limit: number = 50,
  enabled: boolean = true,
  filters: AuditFilters = {},
) {
  return useQuery({
    queryKey: ['audit', 'cross-instance', page, limit, filters],
    queryFn: () => getCrossInstanceAudit({ page, limit, ...filters }),
    enabled,
    staleTime: 15_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    // Keep the previous page on screen while a filter change or page turn loads.
    placeholderData: (previous) => previous,
  });
}

/** All sites, for the site filter (admin only). */
export function useAuditSites(enabled: boolean = true) {
  return useQuery({
    queryKey: ['audit', 'sites'],
    queryFn: getAuditSites,
    enabled,
    staleTime: 5 * 60_000,
  });
}
