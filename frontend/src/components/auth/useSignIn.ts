/**
 * useSignIn.ts – Finishing a sign-in on the auth screens.
 * `establish(token)` stores the new session and first drops the previous
 * session's query cache: logout does not clear it, so a member's cached
 * ['me'] (isAdmin=false, 5 min staleTime) would otherwise survive into an
 * admin's session in the same tab. `complete(token)` also shows the success
 * check and redirects to /app once it has played (successHoldMs).
 * Throws like jwtDecode on a malformed token, so call it inside the caller's
 * try block.
 * Dependencies: tanstack/react-query, react-router, jwt-decode, auth.store,
 * authMotion.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { jwtDecode } from 'jwt-decode';
import { useAuthStore } from '../../stores/auth.store';
import { successHoldMs } from './authMotion';

export function useSignIn() {
  const queryClient = useQueryClient();
  const setTokens = useAuthStore((s) => s.setTokens);
  const navigate = useNavigate();
  const [success, setSuccess] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(timer.current), []);

  const establish = useCallback(
    (accessToken: string) => {
      const decoded = jwtDecode<{ sub: string; email: string }>(accessToken);
      queryClient.clear();
      setTokens(accessToken, { id: decoded.sub, email: decoded.email });
    },
    [queryClient, setTokens],
  );

  const complete = useCallback(
    (accessToken: string) => {
      establish(accessToken);
      setSuccess(true);
      timer.current = setTimeout(() => navigate('/app', { replace: true }), successHoldMs());
    },
    [establish, navigate],
  );

  return { success, establish, complete };
}
