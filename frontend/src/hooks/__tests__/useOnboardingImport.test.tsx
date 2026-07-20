/**
 * useOnboardingImport.test.tsx — covers useOnboardingImport(), the mutation
 * hook wrapping onboarding.api's importOnboarding. The api module is mocked
 * so nothing hits the network; a QueryClient.invalidateQueries spy asserts
 * the org/instance caches are refreshed by prefix on success (a bulk import
 * can create or update organizations across many instances at once, so there
 * is no single instanceId to target).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const importOnboarding = vi.hoisted(() => vi.fn());
vi.mock('../../api/onboarding.api', () => ({ importOnboarding }));

import { useOnboardingImport } from '../useOnboardingImport';
import type { OnboardingImportResult } from '../../api/onboarding.api';

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

const invalidatedKeys = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.map((c) => (c[0] as { queryKey?: unknown[] } | undefined)?.queryKey);

beforeEach(() => {
  importOnboarding.mockReset();
});

describe('useOnboardingImport', () => {
  it('calls importOnboarding(file), resolves with the result, and invalidates org/instance caches', async () => {
    const file = new File(['organizationIdentifier\nukm.de'], 'sites.csv', { type: 'text/csv' });
    const resultFixture: OnboardingImportResult = {
      summary: { created: 1, updated: 0, failed: 0 },
      rows: [{ identifier: 'ukm.de', action: 'created', ok: true }],
      parseErrors: [],
    };
    importOnboarding.mockResolvedValue(resultFixture);
    const { wrapper, invalidateSpy } = makeHarness();

    const { result } = renderHook(() => useOnboardingImport(), { wrapper });
    const data = await result.current.mutateAsync(file);

    expect(importOnboarding).toHaveBeenCalledWith(file);
    expect(data).toEqual(resultFixture);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const keys = invalidatedKeys(invalidateSpy);
    expect(keys).toContainEqual(['organization']);
    expect(keys).toContainEqual(['instances']);
  });

  it('does not invalidate anything when the import call rejects', async () => {
    importOnboarding.mockRejectedValue(new Error('bad file'));
    const { wrapper, invalidateSpy } = makeHarness();

    const { result } = renderHook(() => useOnboardingImport(), { wrapper });
    const file = new File(['x'], 'x.csv', { type: 'text/csv' });

    await expect(result.current.mutateAsync(file)).rejects.toThrow('bad file');
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
