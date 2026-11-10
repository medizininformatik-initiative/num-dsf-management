/**
 * TotpEnrolmentPage.tsx – /totp-enrolment: the forced one-time TOTP setup of an
 * administrator who signed in with a client certificate. It opens with a plain
 * explanation (only administrators need TOTP, only for sensitive actions; what
 * the TAN list is), then QR code + first code, then the TAN list with download
 * and print and a required "stored" confirmation. Until it is done every other
 * API route answers 403 TOTP_ENROLMENT_REQUIRED, and the router sends the
 * session here. Finishing clears that state and continues to /app.
 * Dependencies: AuthLayout, TotpEnrolmentFlow, auth store, useMe, i18n store,
 * react-query.
 */
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AuthLayout } from '../components/AuthLayout';
import { TotpEnrolmentFlow } from '../components/auth/TotpEnrolmentFlow';
import { useAuthStore } from '../stores/auth.store';
import { useI18n } from '../stores/i18n.store';
import { TOTP_STATUS_KEY } from '../hooks/useTotpStatus';

export function TotpEnrolmentPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const email = useAuthStore((s) => s.user?.email);

  function finished() {
    useAuthStore.getState().setTotpEnrolmentRequired(false);
    void queryClient.invalidateQueries({ queryKey: ['me'] });
    void queryClient.invalidateQueries({ queryKey: TOTP_STATUS_KEY });
    navigate('/app', { replace: true });
  }

  return (
    <AuthLayout title={t('totpEnrolTitle')} subtitle={t('totpEnrolSubtitle')} step={2}>
      <TotpEnrolmentFlow
        showIntro
        email={email}
        continueLabel={t('totpBackupContinueBtn')}
        onFinished={finished}
      />
    </AuthLayout>
  );
}
