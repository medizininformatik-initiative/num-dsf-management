/**
 * SecurityPage.tsx – /app/security: the administrator's authenticator app and
 * TAN list. Shows whether TOTP is active and how many TANs are left (a warning
 * from 3 down), generates a new TAN list after a step-up (the old list stops
 * working) and sets up a new authenticator app, for which the current code or a
 * TAN is asked first. A new TAN list is shown once, with download and print.
 * Dependencies: useTotpStatus, useMe, meTotp.api, AdminPageHeader,
 * StepUpConfirmDialog, TotpCodeField, TanListPanel, TotpEnrolmentFlow, Button,
 * Icon, authMode, stepUpCode, getErrorMessage, i18n store, sonner.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AdminPageHeader } from '../components/admin/AdminPageHeader';
import { StepUpConfirmDialog } from '../components/admin/StepUpConfirmDialog';
import { TotpCodeField } from '../components/admin/TotpCodeField';
import { TanListPanel } from '../components/auth/TanListPanel';
import { TotpEnrolmentFlow } from '../components/auth/TotpEnrolmentFlow';
import { Button } from '../components/ui/Button';
import { Icon } from '../components/ui/Icon';
import { meTotpApi } from '../api/meTotp.api';
import { LOW_TAN_THRESHOLD, TOTP_STATUS_KEY, useTotpStatus } from '../hooks/useTotpStatus';
import { useMe } from '../hooks/useMe';
import { needsTotpStepUp } from '../lib/authMode';
import { getErrorMessageForStepUp } from '../lib/getErrorMessage';
import { isStepUpCodeComplete } from '../lib/stepUpCode';
import { useI18n } from '../stores/i18n.store';

type View =
  | { kind: 'overview' }
  | { kind: 'confirm-regenerate' }
  | { kind: 'tans'; codes: string[] }
  | { kind: 'ask-code' }
  | { kind: 'resetup'; currentCode: string };

export function SecurityPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const status = useTotpStatus();
  const [view, setView] = useState<View>({ kind: 'overview' });
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);

  const refresh = () => queryClient.invalidateQueries({ queryKey: TOTP_STATUS_KEY });
  const remaining = status.data?.remainingTans ?? 0;
  const low = !!status.data?.enabled && remaining <= LOW_TAN_THRESHOLD;

  async function regenerate(totpCode?: string) {
    setPending(true);
    try {
      const codes = await meTotpApi.regenerateTans(totpCode);
      setCode('');
      setView({ kind: 'tans', codes });
      void refresh();
    } catch (err) {
      setCode('');
      toast.error(
        getErrorMessageForStepUp(err, t('securityRegenerateFailed'), t('certStepUpFailedToast')),
      );
    } finally {
      setPending(false);
    }
  }

  function backToOverview() {
    setView({ kind: 'overview' });
    void refresh();
  }

  return (
    <div className="flex-1 overflow-y-auto" data-testid="security-page">
      <AdminPageHeader title={t('securityTitle')} subtitle={t('securitySubtitle')} />
      <div className="mx-auto max-w-xl space-y-6 px-6 py-6 sm:px-8">
        {view.kind === 'overview' && (
          <>
            {!me?.isAdmin && (
              <p className="text-sm text-[color:var(--text-secondary)]">
                {t('securityOnlyAdmins')}
              </p>
            )}
            {me?.isAdmin && status.data && (
              <section className="space-y-3 rounded-card border border-[color:var(--border)] p-4">
                <p className="flex items-center gap-2 text-sm font-semibold text-[color:var(--text-primary)]">
                  <Icon name={status.data.enabled ? 'verified_user' : 'gpp_maybe'} size={18} />
                  {status.data.enabled ? t('securityTotpActive') : t('securityTotpInactive')}
                </p>
                {status.data.enabled && (
                  <p
                    className={`text-sm ${low ? 'font-semibold text-warning-fg' : 'text-[color:var(--text-secondary)]'}`}
                    role={low ? 'alert' : undefined}
                  >
                    {low
                      ? t('securityTansLow', { n: remaining })
                      : t('securityTansRemaining', { n: remaining })}
                  </p>
                )}
                {status.data.enabled && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() => {
                        setCode('');
                        if (needsTotpStepUp()) setView({ kind: 'confirm-regenerate' });
                        else void regenerate();
                      }}
                    >
                      {t('securityRegenerate')}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setCode('');
                        setView({ kind: 'ask-code' });
                      }}
                    >
                      {t('securityResetup')}
                    </Button>
                  </div>
                )}
                {status.data.enabled && (
                  <p className="text-xs text-[color:var(--text-muted)]">
                    {t('securityResetupHint')}
                  </p>
                )}
              </section>
            )}
          </>
        )}

        {view.kind === 'tans' && (
          <TanListPanel
            codes={view.codes}
            email={me?.email}
            continueLabel={t('totpBackupContinueBtn')}
            onContinue={backToOverview}
          />
        )}

        {view.kind === 'ask-code' && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (isStepUpCodeComplete(code)) setView({ kind: 'resetup', currentCode: code });
            }}
          >
            <TotpCodeField label={t('totpCodeLabel')} value={code} onChange={setCode} autoFocus />
            <div className="flex gap-2">
              <Button variant="secondary" onClick={backToOverview}>
                {t('cancel')}
              </Button>
              <Button type="submit" disabled={!isStepUpCodeComplete(code)}>
                {t('securityResetupContinue')}
              </Button>
            </div>
          </form>
        )}

        {view.kind === 'resetup' && (
          <TotpEnrolmentFlow
            currentCode={view.currentCode}
            email={me?.email}
            continueLabel={t('totpBackupContinueBtn')}
            onFinished={backToOverview}
          />
        )}
      </div>

      <StepUpConfirmDialog
        open={view.kind === 'confirm-regenerate'}
        title={t('securityRegenerateTitle')}
        consequence={t('securityRegenerateConsequence')}
        confirmLabel={t('securityRegenerate')}
        pending={pending}
        totpCode={code}
        onTotpCodeChange={setCode}
        onConfirm={(totpCode) => void regenerate(totpCode)}
        onCancel={() => setView({ kind: 'overview' })}
      />
    </div>
  );
}
