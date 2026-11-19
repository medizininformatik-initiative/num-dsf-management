/**
 * CertificatePurposeControls.tsx — the two per-certificate choices of a site: "Publish in allow
 * list" (the thumbprint is part of the list other sites download) and "Use for login" (the
 * certificate may sign in as the organization once approved). A checkbox saves at once
 * (PATCH /certificates/:id/purpose); the change takes effect with the next approved request.
 * Used in the certificates card and in the approval dialog.
 * Dependencies: useUpdateCertificatePurpose, useToastMutation-style toast, i18n store.
 */
import { useId } from 'react';
import { toast } from 'sonner';
import { useUpdateCertificatePurpose } from '../../hooks/useCertificates';
import { getErrorMessage } from '../../lib/getErrorMessage';
import { useI18n } from '../../stores/i18n.store';
import type { CertificatePurposePatch } from '../../api/entities.api';

interface Props {
  instanceId: string;
  cert: { id: string; subject?: string; publishInAllowlist?: boolean; useForLogin?: boolean };
}

export function CertificatePurposeControls({ instanceId, cert }: Props) {
  const { t } = useI18n();
  const hintId = useId();
  const mutation = useUpdateCertificatePurpose(instanceId);
  const publish = cert.publishInAllowlist !== false;
  const login = cert.useForLogin !== false;

  function save(patch: CertificatePurposePatch) {
    mutation.mutate(
      { certId: cert.id, patch },
      {
        onSuccess: () => toast.success(t('certPurposeSavedToast')),
        onError: (err) => toast.error(getErrorMessage(err, t('genericActionFailed'))),
      },
    );
  }

  const box =
    'h-4 w-4 shrink-0 rounded-sm border-[color:var(--border-strong)] accent-[color:var(--accent-solid)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-ring)]';
  return (
    <div className="mt-2 space-y-1" data-testid={`cert-purpose-${cert.id}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <label className="flex items-center gap-1.5 text-xs text-[color:var(--text-primary)]">
          <input
            type="checkbox"
            className={box}
            checked={publish}
            disabled={mutation.isPending}
            aria-describedby={hintId}
            onChange={(e) => save({ publishInAllowlist: e.target.checked })}
          />
          {t('certPurposePublish')}
        </label>
        <label className="flex items-center gap-1.5 text-xs text-[color:var(--text-primary)]">
          <input
            type="checkbox"
            className={box}
            checked={login}
            disabled={mutation.isPending}
            aria-describedby={hintId}
            onChange={(e) => save({ useForLogin: e.target.checked })}
          />
          {t('certPurposeLogin')}
        </label>
      </div>
      <p id={hintId} className="text-2xs text-[color:var(--text-muted)]">
        {t('certPurposeHint')}
      </p>
    </div>
  );
}
