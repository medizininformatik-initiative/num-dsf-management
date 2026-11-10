/**
 * AdminUserCertificatesDialog.tsx – colleague recovery: the admin certificates
 * of ANOTHER admin with a remove action each (lost or compromised certificate,
 * immediate) and "Request certificate" for when theirs expired (a four-eyes
 * request that a third admin from another site approves). Both writes need the
 * step-up and notify the affected admin by mail (backend).
 * Dependencies: adminCertificatesApi, Modal, AdminCertificateRow,
 * AddAdminCertificateDialog, StepUpConfirmDialog, Button, i18n store.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminCertificatesApi, type AdminCertificate } from '../../api/adminCertificates.api';
import { useToastMutation } from '../../hooks/useToastMutation';
import { Modal } from '../modals/Modal';
import { Button } from '../ui/Button';
import { AdminCertificateRow } from './AdminCertificateRow';
import { AddAdminCertificateDialog } from './AddAdminCertificateDialog';
import { StepUpConfirmDialog } from './StepUpConfirmDialog';
import { useI18n } from '../../stores/i18n.store';

export const ALL_ADMIN_CERTS_KEY = ['admin', 'certificates', 'all'] as const;

export function AdminUserCertificatesDialog({
  email,
  onClose,
}: {
  email: string | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<AdminCertificate | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const { data } = useQuery({
    queryKey: ALL_ADMIN_CERTS_KEY,
    queryFn: adminCertificatesApi.all,
    enabled: email !== null,
  });
  const certs = (data ?? []).filter((c) => c.email.toLowerCase() === email?.toLowerCase());

  const remove = useToastMutation({
    mutationFn: (vars: { id: string; totpCode?: string }) =>
      adminCertificatesApi.removeFor(email!, vars.id, vars.totpCode),
    successMessage: t('adminCertRemovedToast'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'certificates'] }),
    errorFallback: t('genericActionFailed'),
    errorMessages: { LAST_OTHER_ADMIN_CERT: t('adminCertErr_LAST_OTHER_ADMIN_CERT') },
  });

  function closeRemove() {
    setRemoving(null);
    setTotpCode('');
  }

  return (
    <>
      <Modal
        open={email !== null}
        onClose={onClose}
        title={t('adminCertUserTitle')}
        subtitle={email ?? undefined}
        width="max-w-2xl"
      >
        <div className="space-y-4">
          <p className="text-sm text-[color:var(--text-secondary)]">
            {t('adminCertUserRequestIntro')}
          </p>
          {certs.length === 0 ? (
            <p className="text-sm text-[color:var(--text-muted)]">{t('adminCertUserNone')}</p>
          ) : (
            <ul className="overflow-hidden rounded-control border border-[color:var(--border)]">
              {certs.map((c) => (
                <AdminCertificateRow
                  key={c.id}
                  cert={c}
                  actions={
                    <Button
                      size="sm"
                      variant="secondary"
                      className="text-danger-fg"
                      onClick={() => {
                        setTotpCode('');
                        setRemoving(c);
                      }}
                    >
                      {t('adminCertRemove')}
                    </Button>
                  }
                />
              ))}
            </ul>
          )}
          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={onClose}>
              {t('adminCertClose')}
            </Button>
            <Button onClick={() => setAdding(true)}>{t('adminCertUserRequest')}</Button>
          </div>
        </div>
      </Modal>

      <AddAdminCertificateDialog
        open={adding && email !== null}
        onClose={() => setAdding(false)}
        forEmail={email ?? undefined}
      />

      <StepUpConfirmDialog
        open={removing !== null}
        title={t('adminCertRemoveTitle')}
        subtitle={email ?? undefined}
        message={t('adminCertUserRemoveBody')}
        confirmLabel={t('adminCertRemove')}
        destructive
        pending={remove.isPending}
        totpCode={totpCode}
        onTotpCodeChange={setTotpCode}
        onCancel={closeRemove}
        onConfirm={(code) => {
          if (!removing) return;
          remove.mutate(
            { id: removing.id, ...(code !== undefined ? { totpCode: code } : {}) },
            { onSuccess: closeRemove, onError: () => setTotpCode('') },
          );
        }}
      />
    </>
  );
}
