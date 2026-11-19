/**
 * useIncidents.ts – read hooks of the incident register: the incidents the
 * caller may see (open first), one incident with its timeline and hash-chain
 * status, the sites for the report form, and whether a confirmed incident is
 * still open (drives the red banner). The list polls every minute so the
 * banner appears without a reload.
 * Dependencies: incidents.api, useAuthStore, TanStack Query.
 */
import { useQuery } from '@tanstack/react-query';
import { incidentsApi, type Incident } from '../api/incidents.api';
import { useAuthStore } from '../stores/auth.store';

export const INCIDENTS_KEY = ['incidents'] as const;
/** The admin list including archived incidents. */
export const INCIDENTS_WITH_ARCHIVED_KEY = ['incidents', 'with-archived'] as const;
export const incidentKey = (id: string) => ['incidents', 'detail', id] as const;
export const blockLiftsKey = (id: string) => ['incidents', 'block-lifts', id] as const;
export const INCIDENT_SITES_KEY = ['incidents', 'organizations'] as const;

export function useIncidents(includeArchived = false) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({
    queryKey: includeArchived ? INCIDENTS_WITH_ARCHIVED_KEY : INCIDENTS_KEY,
    queryFn: () => incidentsApi.list(includeArchived).then((r) => r.data.data),
    enabled: isAuthenticated,
    refetchInterval: 60_000,
    // The default staleTime (30 s) and focus refetch off would keep an old
    // list on screen; a confirmed incident must show up on the next focus or mount.
    staleTime: 0,
    refetchOnWindowFocus: 'always',
    refetchOnMount: 'always',
  });
}

export function useIncident(id: string | null) {
  return useQuery({
    queryKey: incidentKey(id ?? ''),
    queryFn: () => incidentsApi.get(id!).then((r) => r.data.data),
    enabled: !!id,
  });
}

/** Blocked thumbprints of an incident with their lifted state, and the pending lift request. */
export function useBlockLifts(id: string | null, enabled = true) {
  return useQuery({
    queryKey: blockLiftsKey(id ?? ''),
    queryFn: () => incidentsApi.blockLifts(id!).then((r) => r.data.data),
    enabled: !!id && enabled,
  });
}

export function useIncidentSites(enabled = true) {
  return useQuery({
    queryKey: INCIDENT_SITES_KEY,
    queryFn: () => incidentsApi.organizations().then((r) => r.data.data),
    enabled,
    staleTime: 5 * 60_000,
  });
}

/** Confirmed and not yet closed: the network is told about it. */
export function isActiveIncident(incident: Incident): boolean {
  return incident.status === 'CONFIRMED';
}

/** The confirmed, unclosed incidents among the visible ones. */
export function useActiveIncidents(): Incident[] {
  const { data } = useIncidents();
  return (data ?? []).filter(isActiveIncident);
}
