/**
 * useLoginCertificates.ts — TanStack Query hooks for the login certificates of an
 * organization: the read-only list for the certificates card, and the admin
 * mutations (enable a certificate as login, remove a login entry). Mutations
 * refresh the list.
 * Dependencies: loginCertificates.api, TanStack Query
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { loginCertificatesApi } from '../api/loginCertificates.api';

const key = (instanceId: string | null) => ['login-certificates', instanceId] as const;

export function useLoginCertificates(instanceId: string | null) {
  return useQuery({
    queryKey: key(instanceId),
    queryFn: () => loginCertificatesApi.list(instanceId!).then((r) => r.data.data),
    enabled: !!instanceId,
    staleTime: 30_000,
  });
}

export function useEnableLoginCertificate(instanceId: string, organization: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { certificateId: string; totpCode?: string }) =>
      loginCertificatesApi.enable(organization, vars.certificateId, vars.totpCode),
    onSettled: () => qc.invalidateQueries({ queryKey: key(instanceId) }),
  });
}

export function useRemoveLoginCertificate(instanceId: string, organization: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { fingerprint: string; totpCode?: string }) =>
      loginCertificatesApi.remove(organization, vars.fingerprint, vars.totpCode),
    onSettled: () => qc.invalidateQueries({ queryKey: key(instanceId) }),
  });
}
