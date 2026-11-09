/**
 * ExpiryWarningBanner.tsx — banner for the active instance's certificates that have expired or
 * expire soon, worded and toned per certificate by certValidity (expired / renew now /
 * expiring), with a "Renew now" action. Instead of pushing the canvas down in one jump when
 * the query resolves, it grows open with a height + opacity transition (grid rows 0fr → 1fr
 * on the foundation durations; the height changes instantly under Reduce Motion) and
 * collapses the same way once nothing is due. Tinted with the status tone tokens, so it
 * follows light and dark mode.
 * Dependencies: TanStack Query, canvas store, entities api, lib/certStatus, usePresence,
 * lib/motion, useModals, i18n store, Button, Icon.
 */
import { useId, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useCanvasStore } from '../../stores/canvas.store';
import { api } from '../../api/entities.api';
import { CERT_STATE_TONE, certValidity, type CertValidity } from '../../lib/certStatus';
import { usePresence } from '../../hooks/usePresence';
import { exitMs } from '../../lib/motion';
import { useModals } from '../../hooks/useModals';
import { useI18n } from '../../stores/i18n.store';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';

interface ExpiringCert {
  id: string;
  subject: string;
  valid_until: string;
}

type DueCert = ExpiringCert & CertValidity;

const TONE_TEXT = {
  success: 'text-success-fg',
  warning: 'text-warning-fg',
  danger: 'text-danger-fg',
} as const;

const TONE_SURFACE = {
  warning: 'border-warning-border bg-warning-surface',
  danger: 'border-danger-border bg-danger-surface',
} as const;

export function ExpiryWarningBanner() {
  const { t } = useI18n();
  const titleId = useId();
  const activeInstanceId = useCanvasStore((s) => s.activeInstanceId);
  const { data: expiring = [] } = useQuery({
    queryKey: ['certs-expiring', activeInstanceId],
    queryFn: () =>
      api(activeInstanceId!)
        .getExpiringCerts()
        .then((r) => r.data.data as ExpiringCert[]),
    enabled: !!activeInstanceId,
    staleTime: 60_000,
  });

  // The endpoint's window is "within 90 days"; certValidity decides what is actually due.
  const due: DueCert[] = expiring
    .map((cert) => ({ ...cert, ...certValidity(cert.valid_until) }))
    .filter((cert) => cert.state !== 'valid');
  const open = due.length > 0;
  // Keep showing the last list while the banner collapses.
  const shown = useRef(due);
  if (open) shown.current = due;
  const { mounted } = usePresence(open, exitMs('medium'));

  const list = shown.current;
  const expiredCount = list.filter((cert) => cert.state === 'expired').length;
  const tone = list.some((cert) => CERT_STATE_TONE[cert.state] === 'danger') ? 'danger' : 'warning';
  const title =
    expiredCount > 1
      ? t('expiryBannerExpiredPlural', { n: expiredCount })
      : expiredCount === 1
        ? t('expiryBannerExpired')
        : list.length > 1
          ? t('expiryBannerTitlePlural', { n: list.length })
          : t('expiryBannerTitle', { n: list.length });

  return (
    <div
      data-state={open ? 'open' : 'closed'}
      className={`grid transition-[grid-template-rows,opacity] ${
        open
          ? 'grid-rows-[1fr] opacity-100 duration-medium ease-standard'
          : 'grid-rows-[0fr] opacity-0 duration-medium-exit ease-exit'
      }`}
    >
      <div className="min-h-0 overflow-hidden">
        {mounted && (
          <section
            aria-labelledby={titleId}
            className={`mx-5 mt-2 flex flex-wrap items-start gap-3 rounded-card border p-3.5 ${TONE_SURFACE[tone]}`}
          >
            <Icon
              name={tone === 'danger' ? 'error' : 'warning'}
              size={20}
              className={`mt-0.5 shrink-0 ${TONE_TEXT[tone]}`}
            />
            <div className="min-w-0 flex-1">
              <p id={titleId} className={`text-[13px] font-bold ${TONE_TEXT[tone]}`}>
                {title}
              </p>
              <ul className="mt-1 space-y-0.5">
                {list.map((cert) => (
                  <li key={cert.id} className="text-xs text-[color:var(--text-secondary)]">
                    <span className="mono-id break-all">{cert.subject}</span>
                    {' · '}
                    <span className={`font-semibold ${TONE_TEXT[CERT_STATE_TONE[cert.state]]}`}>
                      {cert.state === 'expired'
                        ? t('certCardExpiredDaysAgo', { n: -cert.days })
                        : t('expiryDaysRemaining', { n: cert.days })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <Button
              variant={tone === 'danger' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => useModals.getState().openModal('cert-renew')}
              className="shrink-0"
            >
              <Icon name="autorenew" size={16} />
              {t('expiryBannerRenew')}
            </Button>
          </section>
        )}
      </div>
    </div>
  );
}
