/**
 * useLoginCertificateActions.tsx — the admin side of the "Login" flag in the certificates
 * card: request(enable | disable) opens a StepUpConfirmDialog (authenticator code in OTP
 * sessions, none in certificate sessions), runs the mutation, toasts the outcome and
 * maps the backend refusals (admin certificate, certificate used by another organization).
 * Returns the dialog element, which the caller renders once.
 * Dependencies: useLoginCertificates, StepUpConfirmDialog, getErrorMessage, i18n store, sonner.
 */
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import {
  useEnableLoginCertificate,
  useRemoveLoginCertificate,
} from '../../hooks/useLoginCertificates';
import { StepUpConfirmDialog } from '../admin/StepUpConfirmDialog';
import { getErrorCode, getErrorMessageForStepUp } from '../../lib/getErrorMessage';
import { useI18n } from '../../stores/i18n.store';

export type LoginCertificateAction =
  | { kind: 'enable'; certificateId: string; name: string }
  | { kind: 'disable'; fingerprint: string; name: string };

export function useLoginCertificateActions(
  instanceId: string,
  organization: string | undefined,
): { request: (action: LoginCertificateAction) => void; dialog: ReactNode } {
  const { t } = useI18n();
  const [pending, setPending] = useState<LoginCertificateAction | null>(null);
  const [code, setCode] = useState('');
  const org = organization ?? '';
  const enableMut = useEnableLoginCertificate(instanceId, org);
  const removeMut = useRemoveLoginCertificate(instanceId, org);
  const busy = enableMut.isPending || removeMut.isPending;

  function onError(err: unknown) {
    setCode('');
    const known = getErrorCode(err);
    if (known === 'ADMIN_CERTIFICATE') return toast.error(t('loginCertErrAdminCert'));
    if (known === 'NOT_CLINIC_UPLOADED') return toast.error(t('loginCertErrNotClinic'));
    if (known === 'NOT_FOR_LOGIN') return toast.error(t('loginCertErrNotForLogin'));
    if (known === 'FINGERPRINT_IN_USE') return toast.error(t('loginCertErrInUse'));
    if (known === 'CERT_BLOCKED') return toast.error(t('loginCertErrBlocked'));
    toast.error(
      getErrorMessageForStepUp(err, t('loginCertChangeFailed'), t('certStepUpFailedToast')),
    );
  }

  function confirm(totpCode: string | undefined) {
    if (!pending) return;
    const done = (message: string) => {
      setPending(null);
      setCode('');
      toast.success(message);
    };
    if (pending.kind === 'enable') {
      enableMut.mutate(
        { certificateId: pending.certificateId, totpCode },
        { onSuccess: () => done(t('loginCertEnabledToast')), onError },
      );
    } else {
      removeMut.mutate(
        { fingerprint: pending.fingerprint, totpCode },
        { onSuccess: () => done(t('loginCertDisabledToast')), onError },
      );
    }
  }

  const enabling = pending?.kind === 'enable';
  const dialog = (
    <StepUpConfirmDialog
      open={pending !== null}
      title={enabling ? t('loginCertEnableTitle') : t('loginCertDisableTitle')}
      subtitle={pending?.name}
      message={
        enabling ? t('loginCertEnableMessage', { org }) : t('loginCertDisableMessage', { org })
      }
      consequence={enabling ? undefined : t('loginCertDisableConsequence')}
      confirmLabel={enabling ? t('loginCertEnableConfirm') : t('loginCertDisableConfirm')}
      destructive={!enabling}
      pending={busy}
      totpCode={code}
      onTotpCodeChange={setCode}
      onConfirm={confirm}
      onCancel={() => {
        setPending(null);
        setCode('');
      }}
    />
  );

  return {
    request: (action) => {
      setCode('');
      setPending(action);
    },
    dialog,
  };
}
