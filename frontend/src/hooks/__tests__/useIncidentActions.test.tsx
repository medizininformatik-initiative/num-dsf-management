/**
 * useIncidentActions.test.tsx — the incident write hooks: each passes its
 * arguments through to incidentsApi (the step-up code included) and refreshes
 * the list and the incident's detail; a suspension also refreshes the network
 * map. incidents.api is mocked; the per-test QueryClient's invalidateQueries
 * is spied to assert refreshed keys.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
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

import {
  useReportIncident,
  useConfirmIncident,
  useSuspendSite,
  useCloseIncident,
  useAcknowledgeNis2,
} from '../useIncidentActions';

function makeHarness() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
  function wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return { wrapper, invalidateSpy };
}

const keys = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.map((c) => (c[0] as { queryKey?: unknown[] } | undefined)?.queryKey);

const incident = (id: string, status: Incident['status']) => ({ id, status }) as Incident;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('incident writes', () => {
  it('reporting refreshes the list', async () => {
    api.report.mockResolvedValue({ data: { data: incident('new', 'REPORTED') } });
    const { wrapper, invalidateSpy } = makeHarness();
    const { result } = renderHook(() => useReportIncident(), { wrapper });
    const body = { title: 'Leak', description: 'x', escalationLevel: 2 as const };
    await act(() => result.current.mutateAsync(body));
    expect(api.report).toHaveBeenCalledWith(body);
    expect(keys(invalidateSpy)).toContainEqual(['incidents']);
  });

  it('confirm passes the step-up code and refreshes the detail', async () => {
    api.confirm.mockResolvedValue({ data: { data: incident('i1', 'CONFIRMED') } });
    const { wrapper, invalidateSpy } = makeHarness();
    const { result } = renderHook(() => useConfirmIncident('i1'), { wrapper });
    await act(() => result.current.mutateAsync('123456'));
    expect(api.confirm).toHaveBeenCalledWith('i1', '123456');
    expect(keys(invalidateSpy)).toEqual(
      expect.arrayContaining([['incidents'], ['incidents', 'detail', 'i1']]),
    );
  });

  it('suspend sends measures and confirm, and refreshes the network map', async () => {
    api.suspend.mockResolvedValue({ data: { data: { incident: {}, results: [] } } });
    const { wrapper, invalidateSpy } = makeHarness();
    const { result } = renderHook(() => useSuspendSite('i1'), { wrapper });
    await act(() =>
      result.current.mutateAsync({ measures: ['WITHDRAW'], confirm: true, totpCode: undefined }),
    );
    expect(api.suspend).toHaveBeenCalledWith(
      'i1',
      { measures: ['WITHDRAW'], confirm: true },
      undefined,
    );
    expect(keys(invalidateSpy)).toContainEqual(['network', 'map']);
  });

  it('close sends the outcome and note', async () => {
    api.close.mockResolvedValue({ data: { data: incident('i1', 'CLOSED') } });
    const { wrapper } = makeHarness();
    const { result } = renderHook(() => useCloseIncident('i1'), { wrapper });
    await act(() =>
      result.current.mutateAsync({ outcome: 'FALSE_ALARM', note: 'test mail', totpCode: '000111' }),
    );
    expect(api.close).toHaveBeenCalledWith(
      'i1',
      { outcome: 'FALSE_ALARM', note: 'test mail' },
      '000111',
    );
  });

  it('a failed NIS2 tick still refreshes the detail', async () => {
    api.acknowledgeNis2.mockRejectedValue(new Error('409'));
    const { wrapper, invalidateSpy } = makeHarness();
    const { result } = renderHook(() => useAcknowledgeNis2('i1'), { wrapper });
    await act(async () => {
      await result.current.mutateAsync('NOTIFICATION').catch(() => undefined);
    });
    expect(api.acknowledgeNis2).toHaveBeenCalledWith('i1', 'NOTIFICATION');
    expect(keys(invalidateSpy)).toContainEqual(['incidents', 'detail', 'i1']);
  });
});
