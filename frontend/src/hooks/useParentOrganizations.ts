/**
 * useParentOrganizations.ts — TanStack Query hook for the parent organizations offered in the
 * membership form (known Verbünde plus parents already in use). Cached; the list changes rarely.
 */
import { useQuery } from '@tanstack/react-query';
import {
  parentOrganizationsApi,
  type ParentOrganizationOption,
} from '../api/parentOrganizations.api';

export function useParentOrganizations() {
  return useQuery<ParentOrganizationOption[]>({
    queryKey: ['parent-organizations'],
    queryFn: () => parentOrganizationsApi.list().then((r) => r.data.data),
    staleTime: 5 * 60_000,
  });
}
