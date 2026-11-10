/**
 * useInstance.ts — TanStack Query hooks for a single instance, the instance list and the dashboard overview.
 * Gated on an authenticated user; useInstances auto-selects the first instance as active.
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api } from '../api/entities.api';
import { useCanvasStore } from '../stores/canvas.store';
import { useAuthStore } from '../stores/auth.store';

export interface InstanceRow {
  id: string;
  label: string;
  owner_email?: string | null;
}

export function useInstance(instanceId: string | null) {
  const user = useAuthStore((s) => s.user);
  return useQuery<InstanceRow>({
    queryKey: ['instances', instanceId],
    queryFn: () =>
      api(instanceId!)
        .getInstance(instanceId!)
        .then((r) => r.data.data as InstanceRow),
    enabled: !!user && !!instanceId,
    staleTime: 60_000,
  });
}

export function useInstances() {
  const setActiveInstance = useCanvasStore((s) => s.setActiveInstance);
  const activeInstanceId = useCanvasStore((s) => s.activeInstanceId);
  const user = useAuthStore((s) => s.user);

  const query = useQuery({
    queryKey: ['instances'],
    queryFn: () =>
      api('_')
        .getInstances()
        .then((r) => r.data.data as { id: string; label: string }[]),
    enabled: !!user,
    staleTime: 60_000,
  });

  useEffect(() => {
    const list = query.data;
    if (!list) return; // still loading — keep the current selection
    const stillPresent = activeInstanceId != null && list.some((i) => i.id === activeInstanceId);
    if (stillPresent) return;
    // No selection yet, or the active instance vanished from a refetch: fall
    // back to the first instance, or clear when the list is now empty.
    setActiveInstance(list[0]?.id ?? null);
  }, [query.data, activeInstanceId, setActiveInstance]);

  return query;
}

export type InstanceApprovalStatus =
  | 'NONE'
  | 'DRAFT'
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'WITHDRAWN';

/** One row of the instance list with its approval summary, for the dashboard overview. */
export interface InstanceOverviewRow {
  id: string;
  label: string;
  /** The caller owns the instance (only owners can archive or delete it). */
  is_owner: boolean;
  archived_at: string | null;
  approval_status: InstanceApprovalStatus;
  last_approved_at: string | null;
}

/** Instance list including archived ones; archived rows carry archived_at. */
export function useInstanceOverview() {
  const user = useAuthStore((s) => s.user);
  return useQuery({
    queryKey: ['instances', 'overview'],
    queryFn: () =>
      api('_')
        .getInstances(true)
        .then((r) => r.data.data as InstanceOverviewRow[]),
    enabled: !!user,
    staleTime: 60_000,
  });
}
