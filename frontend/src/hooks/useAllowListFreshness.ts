/**
 * useAllowListFreshness.ts — TanStack Query hook for "has this site obtained the
 * current allow-list version?". Polls every minute and on window focus, since a
 * DSF fetch happens outside the browser; a download in the dialog refreshes it
 * at once through useRefreshAllowListFreshness.
 * Dependencies: entities API.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/entities.api';

export const FRESHNESS_POLL_MS = 60_000;

export const freshnessKey = (instanceId: string | null) =>
  ['allow-list-freshness', instanceId] as const;

export function useAllowListFreshness(instanceId: string | null) {
  return useQuery({
    queryKey: freshnessKey(instanceId),
    queryFn: () =>
      api(instanceId!)
        .getAllowListFreshness()
        .then((r) => r.data.data),
    enabled: !!instanceId,
    staleTime: 30_000,
    refetchInterval: FRESHNESS_POLL_MS,
    refetchOnWindowFocus: true,
  });
}

/** Returns a function that refetches the freshness of one instance (after a download). */
export function useRefreshAllowListFreshness(instanceId: string | null) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: freshnessKey(instanceId) });
}
