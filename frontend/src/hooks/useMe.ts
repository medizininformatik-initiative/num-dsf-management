/**
 * useMe.ts – Returns current user info incl. isAdmin flag
 * Dependencies: auth.api, tanstack/react-query, auth.store
 */
import { useQuery } from '@tanstack/react-query';
import { authApi } from '../api/auth.api';
import { useAuthStore } from '../stores/auth.store';

export interface MeInfo {
  email: string;
  isAdmin: boolean;
  /** An admin certificate session that has to set up TOTP before anything else. */
  totpEnrolmentRequired?: boolean;
}

export function useMe() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery<MeInfo>({
    queryKey: ['me'],
    queryFn: () => authApi.getMe().then((r) => r.data.data),
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000,
  });
}
