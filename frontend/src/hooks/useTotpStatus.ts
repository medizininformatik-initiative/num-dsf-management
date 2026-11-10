/**
 * useTotpStatus.ts – TOTP status of the signed-in user: enabled, how many TANs
 * are left and whether enrolment is still required.
 * Dependencies: meTotp.api, tanstack/react-query, auth.store
 */
import { useQuery } from '@tanstack/react-query';
import { meTotpApi } from '../api/meTotp.api';
import { useAuthStore } from '../stores/auth.store';

export const TOTP_STATUS_KEY = ['me', 'totp'] as const;
/** From this many TANs down the UI warns that the list is running out. */
export const LOW_TAN_THRESHOLD = 3;

export function useTotpStatus(enabled = true) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({
    queryKey: TOTP_STATUS_KEY,
    queryFn: meTotpApi.status,
    enabled: isAuthenticated && enabled,
    staleTime: 60_000,
  });
}
