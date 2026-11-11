/**
 * TotpEnrolmentPage.tsx – /totp-enrolment: the forced one-time TOTP setup of an
 * administrator who signed in with a client certificate. It opens with a plain
 * explanation (only administrators need TOTP, only for sensitive actions; what
 * the TAN list is), then QR code + first code, then the TAN list with download
 * and print and a required "stored" confirmation. Until it is done every other
 * API route answers 403 TOTP_ENROLMENT_REQUIRED, and the router sends the
 * session here. Finishing clears that state (cache included, so the router does
 * not bounce back) and continues to /app. An already enrolled user who opens
 * the page is sent to /app instead of seeing the intro.
 * Dependencies: AuthLayout, TotpEnrolmentFlow, auth store, useMe, i18n store,
 * react-query.
 */
import { useEffect, useRef } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AuthLayout } from '../components/AuthLayout';
import { TotpEnrolmentFlow } from '../components/auth/TotpEnrolmentFlow';
import { useAuthStore } from '../stores/auth.store';
import { useI18n } from '../stores/i18n.store';
import { TOTP_STATUS_KEY } from '../hooks/useTotpStatus';
import { useMe, type MeInfo } from '../hooks/useMe';

export function TotpEnrolmentPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const email = useAuthStore((s) => s.user?.email);

  const flagged = useAuthStore((s) => s.totpEnrolmentRequired);
  const me = useMe();
  // Decide once, on the first answer: a refetch after the TOTP is confirmed
  // must not pull the user off the TAN list before it is stored.
  const decided = useRef(false);
  const alreadyEnrolled = !flagged && !!me.data && !me.data.totpEnrolmentRequired;
  useEffect(() => {
    if (me.data) decided.current = true;
  }, [me.data]);

  function finished() {
    useAuthStore.getState().setTotpEnrolmentRequired(false);
    // Router guards read the cached /auth/me flag; clear it before navigating.
    queryClient.setQueryData<MeInfo>(['me'], (old) =>
      old ? { ...old, totpEnrolmentRequired: false } : old,
    );
    void queryClient.invalidateQueries({ queryKey: ['me'] });
    void queryClient.invalidateQueries({ queryKey: TOTP_STATUS_KEY });
    navigate('/app', { replace: true });
  }

  if (alreadyEnrolled && !decided.current) return <Navigate to="/app" replace />;

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
