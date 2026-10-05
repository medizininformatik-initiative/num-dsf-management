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
const importOnboardingRows = vi.hoisted(() => vi.fn());
const parseOnboardingFile = vi.hoisted(() => vi.fn());
vi.mock('../../api/onboarding.api', () => ({
  importOnboarding,
  importOnboardingRows,
  parseOnboardingFile,
}));

import {
  useOnboardingDryRun,
  useOnboardingImport,
  useOnboardingParse,
} from '../useOnboardingImport';
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
  importOnboardingRows.mockReset();
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

describe('useOnboardingDryRun', () => {
  it('validates a file or rows with dryRun and invalidates no cache', async () => {
    const dry: OnboardingImportResult = {
      dryRun: true,
      summary: { created: 1, updated: 0, failed: 0 },
      rows: [{ identifier: 'ukm.de', action: 'created', ok: true, row: 1 }],
      parseErrors: [],
    };
    importOnboarding.mockResolvedValue(dry);
    importOnboardingRows.mockResolvedValue(dry);
    const { wrapper, invalidateSpy } = makeHarness();
    const { result } = renderHook(() => useOnboardingDryRun(), { wrapper });

    const file = new File(['x'], 'x.csv', { type: 'text/csv' });
    await result.current.mutateAsync(file);
    expect(importOnboarding).toHaveBeenCalledWith(file, { dryRun: true });

    const rows = [
      {
        organizationIdentifier: 'a.example.de',
        organizationName: 'A',
        contactEmail: 'a@a.example.de',
        clientCertFingerprint: 'f',
      },
    ];
    await result.current.mutateAsync(rows);
    expect(importOnboardingRows).toHaveBeenCalledWith(rows, { dryRun: true });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('useOnboardingImport sends editor rows to the rows endpoint', async () => {
    importOnboardingRows.mockResolvedValue({
      summary: { created: 0, updated: 0, failed: 0 },
      rows: [],
      parseErrors: [],
    });
    const { wrapper } = makeHarness();
    const { result } = renderHook(() => useOnboardingImport(), { wrapper });
    await result.current.mutateAsync([]);
    expect(importOnboardingRows).toHaveBeenCalledWith([], undefined);
  });
});

describe('useOnboardingParse', () => {
  it('parses a file without touching any cache', async () => {
    const parsed = { rows: [], parseErrors: [] };
    parseOnboardingFile.mockResolvedValue(parsed);
    const { wrapper, invalidateSpy } = makeHarness();
    const { result } = renderHook(() => useOnboardingParse(), { wrapper });
    const file = new File(['x'], 'a.csv');
    await expect(result.current.mutateAsync(file)).resolves.toBe(parsed);
    expect(parseOnboardingFile).toHaveBeenCalledWith(file);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
