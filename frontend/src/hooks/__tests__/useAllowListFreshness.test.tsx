/**
 * useAllowListFreshness.test.tsx — the freshness query polls every minute and on
 * window focus, is off without an instance, and a download refreshes it at once.
 * The entities API is stubbed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const getAllowListFreshness = vi.hoisted(() => vi.fn());
vi.mock('../../api/entities.api', () => ({
  api: () => ({ getAllowListFreshness }),
}));

import {
  FRESHNESS_POLL_MS,
  freshnessKey,
  useAllowListFreshness,
  useRefreshAllowListFreshness,
} from '../useAllowListFreshness';

const OUTDATED = {
  currentVersion: 4,
  currentPublishedAt: '2026-10-01T10:00:00.000Z',
  lastObtainedVersion: 3,
  lastObtainedAt: '2026-09-30T10:00:00.000Z',
  via: 'DSF',
  outdated: true,
};

let qc: QueryClient;
function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  getAllowListFreshness.mockReset();
  getAllowListFreshness.mockResolvedValue({ data: { data: OUTDATED } });
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

describe('useAllowListFreshness', () => {
  it('returns the freshness read from r.data.data', async () => {
    const { result } = renderHook(() => useAllowListFreshness('i1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(OUTDATED);
  });

  it('polls every minute and refetches on window focus', async () => {
    const { result } = renderHook(() => useAllowListFreshness('i1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const options = qc.getQueryCache().find({ queryKey: freshnessKey('i1') })!.observers[0].options;
    expect(options.refetchInterval).toBe(FRESHNESS_POLL_MS);
    expect(FRESHNESS_POLL_MS).toBe(60_000);
    expect(options.refetchOnWindowFocus).toBe(true);
  });

  it('does not query without an instance', () => {
    renderHook(() => useAllowListFreshness(null), { wrapper });
    expect(getAllowListFreshness).not.toHaveBeenCalled();
  });

  it('refetches at once after the refresh function (a download) ran', async () => {
    const { result } = renderHook(
      () => {
        const q = useAllowListFreshness('i1');
        // Read data during render so the query tracks it and re-renders on change.
        return {
          isSuccess: q.isSuccess,
          data: q.data,
          refresh: useRefreshAllowListFreshness('i1'),
        };
      },
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getAllowListFreshness).toHaveBeenCalledTimes(1);

    getAllowListFreshness.mockResolvedValue({
      data: { data: { ...OUTDATED, lastObtainedVersion: 4, via: 'PORTAL', outdated: false } },
    });
    await act(async () => {
      await result.current.refresh();
    });
    await waitFor(() => expect(result.current.data?.outdated).toBe(false));
    expect(getAllowListFreshness).toHaveBeenCalledTimes(2);
  });
});
