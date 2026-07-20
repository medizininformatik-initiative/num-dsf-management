/**
 * useOnboardingImport.ts – TanStack Query mutation hook for the admin bulk
 * onboarding import. A successful import can create or update organizations
 * across many instances at once, so on success it invalidates every cached
 * organization and instance query by prefix rather than a single instanceId.
 * Dependencies: @tanstack/react-query, onboarding.api
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { importOnboarding, type OnboardingImportResult } from '../api/onboarding.api';

export function useOnboardingImport() {
  const qc = useQueryClient();
  return useMutation<OnboardingImportResult, Error, File>({
    mutationFn: (file: File) => importOnboarding(file),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['organization'] });
      qc.invalidateQueries({ queryKey: ['instances'] });
    },
  });
}
