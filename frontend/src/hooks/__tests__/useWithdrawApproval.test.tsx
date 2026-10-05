/**
 * useWithdrawApproval.test.tsx — the withdraw mutation posts to the API and
 * refreshes approval status and history, whether it succeeds or the backend
 * answers 409 NOT_PENDING (the request was decided in the meantime).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const withdrawApproval = vi.hoisted(() => vi.fn());
vi.mock('../../api/entities.api', () => ({ api: () => ({ withdrawApproval }) }));

import { useWithdrawApproval } from '../useApproval';

function setup() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { invalidate, ...renderHook(() => useWithdrawApproval('i1'), { wrapper }) };
}

const keys = (invalidate: { mock: { calls: unknown[][] } }) =>
  invalidate.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useWithdrawApproval', () => {
  it('withdraws and invalidates status and history', async () => {
    withdrawApproval.mockResolvedValueOnce({ data: { data: { status: 'WITHDRAWN' } } });
    const { result, invalidate } = setup();
    await result.current.mutateAsync();
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(2));
    expect(keys(invalidate)).toEqual([
      ['approval-status', 'i1'],
      ['approval-history', 'i1'],
    ]);
  });

  it('still refreshes the cache when the request was decided meanwhile', async () => {
    withdrawApproval.mockRejectedValueOnce({ response: { status: 409 } });
    const { result, invalidate } = setup();
    await expect(result.current.mutateAsync()).rejects.toBeTruthy();
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(2));
  });
});
