/**
 * useOnboardingImport.ts – TanStack Query mutation hooks for the admin bulk
 * onboarding. useOnboardingImport writes: a successful import can create or
 * update organizations across many instances at once, so on success it
 * invalidates every cached organization and instance query by prefix rather
 * than a single instanceId. useOnboardingDryRun validates the same source
 * (a file, or rows from the in-tool editor) on the server without writing,
 * so it touches no cache. useOnboardingParse turns one uploaded file into
 * validated rows (no database access) for the multi-file merge.
 * Dependencies: @tanstack/react-query, onboarding.api
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  importOnboarding,
  importOnboardingRows,
  parseOnboardingFile,
  type OnboardingParseResult,
  type OnboardingImportResult,
  type OnboardingRowInput,
} from '../api/onboarding.api';

export type OnboardingSource = File | OnboardingRowInput[];

function submit(source: OnboardingSource, dryRun: boolean): Promise<OnboardingImportResult> {
  if (Array.isArray(source)) return importOnboardingRows(source, dryRun ? { dryRun } : undefined);
  return dryRun ? importOnboarding(source, { dryRun }) : importOnboarding(source);
}

export function useOnboardingImport() {
  const qc = useQueryClient();
  return useMutation<OnboardingImportResult, Error, OnboardingSource>({
    mutationFn: (source) => submit(source, false),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['organization'] });
      qc.invalidateQueries({ queryKey: ['instances'] });
    },
  });
}

export function useOnboardingDryRun() {
  return useMutation<OnboardingImportResult, Error, OnboardingSource>({
    mutationFn: (source) => submit(source, true),
  });
}

export function useOnboardingParse() {
  return useMutation<OnboardingParseResult, Error, File>({
    mutationFn: (file) => parseOnboardingFile(file),
  });
}
