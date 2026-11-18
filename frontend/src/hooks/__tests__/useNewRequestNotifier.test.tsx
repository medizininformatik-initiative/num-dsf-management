/**
 * useNewRequestNotifier.test.tsx — first load stays silent, a new id notifies
 * once, several new ids aggregate, non-admins neither poll nor notify, and a
 * failing localStorage is tolerated. The pending endpoint, useMe, sonner and
 * the notification store are stubbed; the real usePendingApprovals runs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { useI18n } from '../../stores/i18n.store';
import { useNotificationStore } from '../../stores/notification.store';

const getPendingApprovals = vi.hoisted(() => vi.fn());
vi.mock('../../api/admin.api', () => ({ adminApi: { getPendingApprovals } }));
const me = vi.hoisted(() => ({
  data: { email: 'a@x.de', isAdmin: true } as { email: string; isAdmin: boolean },
}));
vi.mock('../useMe', () => ({ useMe: () => ({ data: me.data }) }));
const toastInfo = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { info: toastInfo } }));

import { useNewRequestNotifier } from '../useNewRequestNotifier';

const req = (id: string, name?: string) => ({
  id,
  status: 'PENDING',
  snapshot_json: name ? { organization: { name, identifier: `${id}.de` } } : null,
  signatures: [],
});
const reply = (...r: ReturnType<typeof req>[]) =>
  getPendingApprovals.mockResolvedValue({ data: { data: r } });

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  renderHook(() => useNewRequestNotifier(), { wrapper });
  return qc;
}
// Waits until the first list is cached and the hook's effect had a tick to see it.
const loaded = async (qc: QueryClient) => {
  await waitFor(() => expect(qc.getQueryData(['admin', 'pending-approvals'])).toBeDefined());
  await act(async () => {});
};
const refetch = (qc: QueryClient) =>
  act(() => qc.refetchQueries({ queryKey: ['admin', 'pending-approvals'] }));

beforeEach(() => {
  vi.restoreAllMocks();
  getPendingApprovals.mockReset();
  toastInfo.mockReset();
  localStorage.clear();
  me.data = { email: 'a@x.de', isAdmin: true };
  useI18n.getState().setLang('en');
  useNotificationStore.getState().clear();
});

describe('useNewRequestNotifier', () => {
  it('does not notify on the first load', async () => {
    reply(req('r1', 'Alpha'), req('r2'));
    setup();
    await waitFor(() => expect(getPendingApprovals).toHaveBeenCalled());
    await waitFor(() =>
      expect(localStorage.getItem('dsf.seenPendingRequests:a@x.de')).toContain('r1'),
    );
    expect(toastInfo).not.toHaveBeenCalled();
  });

  it('notifies once for a new id, with the organisation name', async () => {
    reply(req('r1'));
    const qc = setup();
    await loaded(qc);
    reply(req('r1'), req('r2', 'Beta Klinik'));
    await refetch(qc);
    await waitFor(() => expect(toastInfo).toHaveBeenCalledTimes(1));
    expect(toastInfo.mock.calls[0][0]).toBe('New approval request: Beta Klinik');
    expect(useNotificationStore.getState().notifications[0].message).toContain('Beta Klinik');
    await refetch(qc);
    expect(toastInfo).toHaveBeenCalledTimes(1);
  });

  it('aggregates several new ids into one toast', async () => {
    reply(req('r1'));
    const qc = setup();
    await loaded(qc);
    reply(req('r1'), req('r2'), req('r3'), req('r4'));
    await refetch(qc);
    await waitFor(() => expect(toastInfo).toHaveBeenCalledTimes(1));
    expect(toastInfo.mock.calls[0][0]).toBe('3 new approval requests');
  });

  it('does nothing for non-admins', async () => {
    me.data = { email: 'u@x.de', isAdmin: false };
    reply(req('r1'));
    setup();
    await new Promise((r) => setTimeout(r, 30));
    expect(getPendingApprovals).not.toHaveBeenCalled();
    expect(toastInfo).not.toHaveBeenCalled();
  });

  it('tolerates a failing localStorage', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    reply(req('r1'));
    const qc = setup();
    await loaded(qc);
    reply(req('r1'), req('r2', 'Beta'));
    await refetch(qc);
    await waitFor(() => expect(toastInfo).toHaveBeenCalledTimes(1));
  });
});
