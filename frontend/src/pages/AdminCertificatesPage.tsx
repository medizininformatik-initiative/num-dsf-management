/**
 * AdminCertificatesPage.tsx – /app/admin/certificates ("My admin
 * certificates"). Lists the signed-in admin's login certificates with expiry
 * pills, marks the one this session uses, lets the admin rename them, hand in
 * a successor while the current certificate is still valid and remove old
 * ones. The current certificate cannot be removed (no lock-out). Removal
 * needs the step-up (TOTP code, or the client certificate in cert sessions).
 * Dependencies: adminCertificatesApi, useMe, AdminPageHeader, AdminCertificateRow,
 * AddAdminCertificateDialog, StepUpConfirmDialog, Button, Skeleton, i18n store.
 */
import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminCertificatesApi, type MyAdminCertificate } from '../api/adminCertificates.api';
import { useMe } from '../hooks/useMe';
import { useToastMutation } from '../hooks/useToastMutation';
import { AdminPageHeader } from '../components/admin/AdminPageHeader';
import { AdminCertificateRow } from '../components/admin/AdminCertificateRow';
import { AddAdminCertificateDialog } from '../components/admin/AddAdminCertificateDialog';
import { StepUpConfirmDialog } from '../components/admin/StepUpConfirmDialog';
import { FIELD_CLASS } from '../components/admin/fieldClasses';
import { Button } from '../components/ui/Button';
import { Icon } from '../components/ui/Icon';
import { Skeleton } from '../components/ui/Skeleton';
import { useI18n } from '../stores/i18n.store';

export const MY_ADMIN_CERTS_KEY = ['admin', 'certificates', 'mine'] as const;

export function AdminCertificatesPage() {
  const { t } = useI18n();
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<MyAdminCertificate | null>(null);
  const [editing, setEditing] = useState<{ id: string; label: string } | null>(null);
  const [totpCode, setTotpCode] = useState('');

  const { data: certs, isLoading } = useQuery({
    queryKey: MY_ADMIN_CERTS_KEY,
    queryFn: adminCertificatesApi.mine,
    enabled: !me || me.isAdmin,
    staleTime: 15_000,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'certificates'] });

  const remove = useToastMutation({
    mutationFn: (vars: { id: string; totpCode?: string }) =>
      adminCertificatesApi.removeMine(vars.id, vars.totpCode),
    successMessage: t('adminCertRemovedToast'),
    onSuccess: invalidate,
    errorFallback: t('genericActionFailed'),
  });
  const rename = useToastMutation({
    mutationFn: (vars: { id: string; label: string }) =>
      adminCertificatesApi.setLabel(vars.id, vars.label.trim() || null),
    successMessage: t('adminCertRenamedToast'),
    onSuccess: invalidate,
    errorFallback: t('genericActionFailed'),
  });

  if (me && !me.isAdmin) return <Navigate to="/app" replace />;

  function closeRemove() {
    setRemoving(null);
    setTotpCode('');
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <AdminPageHeader
        title={t('adminCertTitle')}
        subtitle={t('adminCertSubtitle')}
        actions={
          <Button onClick={() => setAdding(true)}>
            <Icon name="add_circle" size={18} />
            {t('adminCertAddButton')}
          </Button>
        }
      />
      <div className="space-y-5 px-6 py-6 sm:px-8">
        <p className="text-sm text-[color:var(--text-secondary)]">{t('adminCertExplain')}</p>

        {isLoading && (
          <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-card)] p-5">
            <Skeleton lines={3} />
          </div>
        )}

        {certs && certs.length === 0 && (
          <p className="rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-card)] p-5 text-sm text-[color:var(--text-muted)]">
            {t('adminCertEmpty')}
          </p>
        )}

        {certs && certs.length > 0 && (
          <ul className="overflow-hidden rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-card)]">
            {certs.map((c) => (
              <AdminCertificateRow
                key={c.id}
                cert={c}
                current={c.current}
                actions={
                  editing?.id === c.id ? (
                    <form
                      className="flex items-center gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        rename.mutate(editing, { onSuccess: () => setEditing(null) });
                      }}
                    >
                      <input
                        aria-label={t('adminCertLabelField')}
                        className={`${FIELD_CLASS} w-40`}
                        maxLength={100}
                        value={editing.label}
                        onChange={(e) => setEditing({ id: c.id, label: e.target.value })}
                        autoFocus
                      />
                      <Button size="sm" type="submit" disabled={rename.isPending}>
                        {t('adminCertSave')}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setEditing(null)}>
                        {t('cancel')}
                      </Button>
                    </form>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setEditing({ id: c.id, label: c.label ?? '' })}
                      >
                        {t('adminCertRename')}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        className="text-danger-fg"
                        disabled={c.current}
                        title={c.current ? t('adminCertCannotRemoveCurrent') : undefined}
                        onClick={() => {
                          setTotpCode('');
                          setRemoving(c);
                        }}
                      >
                        {t('adminCertRemove')}
                      </Button>
                    </>
                  )
                }
              />
            ))}
          </ul>
        )}
      </div>

      <AddAdminCertificateDialog open={adding} onClose={() => setAdding(false)} />

      <StepUpConfirmDialog
        open={removing !== null}
        title={t('adminCertRemoveTitle')}
        subtitle={removing?.label || removing?.subject || undefined}
        message={t('adminCertRemoveBody')}
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
    </div>
  );
}
