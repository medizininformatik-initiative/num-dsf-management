/**
 * useBundleHistory.ts — TanStack Query hook for the published allow-list
 * versions of one endpoint (newest first), as shown in the download dialog.
 * Dependencies: entities API.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/entities.api';

export function useBundleHistory(instanceId: string, endpointId: string) {
  return useQuery({
    queryKey: ['bundle-history', instanceId, endpointId],
    queryFn: () =>
      api(instanceId)
        .getBundleHistory(endpointId)
        .then((r) => [...r.data.data].sort((a, b) => b.versionNumber - a.versionNumber)),
    enabled: !!instanceId && !!endpointId,
    staleTime: 30_000,
  });
}
