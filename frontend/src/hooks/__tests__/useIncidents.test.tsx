/**
 * useIncidents.test.tsx — the incident read hooks: the list, the detail
 * gated by an id, the sites held back until needed and the active-incident
 * filter behind the red banner. incidents.api is mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import type { Incident } from '../../api/incidents.api';

const api = vi.hoisted(() => ({
  organizations: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  report: vi.fn(),
  acknowledgeNis2: vi.fn(),
  acknowledgeDpo: vi.fn(),
  confirm: vi.fn(),
  suspend: vi.fn(),
  liftSuspension: vi.fn(),
  close: vi.fn(),
  comment: vi.fn(),
  update: vi.fn(),
  export: vi.fn(),
}));
vi.mock('../../api/incidents.api', () => ({ incidentsApi: api }));
vi.mock('../../stores/auth.store', () => ({
  useAuthStore: (sel: (s: { isAuthenticated: boolean }) => unknown) =>
    sel({ isAuthenticated: true }),
}));

import { useIncidents, useIncident, useIncidentSites, useActiveIncidents } from '../useIncidents';

function makeHarness() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return { wrapper };
}

const incident = (id: string, status: Incident['status']) => ({ id, status }) as Incident;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('incident queries', () => {
  it('useIncidents returns r.data.data', async () => {
    api.list.mockResolvedValue({ data: { data: [incident('i1', 'REPORTED')] } });
    const { wrapper } = makeHarness();
    const { result } = renderHook(() => useIncidents(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true), { timeout: 4000 });
    expect(result.current.data).toEqual([{ id: 'i1', status: 'REPORTED' }]);
  });

  it('useIncident waits for an id', async () => {
    api.get.mockResolvedValue({ data: { data: { incident: incident('i1', 'CONFIRMED') } } });
    const { wrapper } = makeHarness();
    const { result, rerender } = renderHook(({ id }) => useIncident(id), {
      wrapper,
      initialProps: { id: null as string | null },
    });
    expect(api.get).not.toHaveBeenCalled();
    rerender({ id: 'i1' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true), { timeout: 4000 });
    expect(api.get).toHaveBeenCalledWith('i1');
  });

  it('useIncidentSites can be held back', () => {
    const { wrapper } = makeHarness();
    renderHook(() => useIncidentSites(false), { wrapper });
    expect(api.organizations).not.toHaveBeenCalled();
  });

  it('useActiveIncidents keeps only confirmed incidents', async () => {
    api.list.mockResolvedValue({
      data: {
        data: [
          incident('a', 'REPORTED'),
          incident('b', 'CONFIRMED'),
          incident('c', 'CLOSED'),
          incident('d', 'FALSE_ALARM'),
        ],
      },
    });
    const { wrapper } = makeHarness();
    const { result } = renderHook(() => useActiveIncidents(), { wrapper });
    await waitFor(() => expect(result.current).toHaveLength(1), { timeout: 4000 });
    expect(result.current[0].id).toBe('b');
  });
});
