/**
 * ExpiryTimeline.tsx – Vertical timeline of the instance's certificate expiry
 * dates, soonest first. Each entry's dot and pill follow the shared
 * classification (certValidity: expired, critical < 30 days, warning < 90
 * days, valid) and its date the app language (formatDate). The right panel
 * renders its own disclosure header and passes showTitle={false}.
 * Depends on: useCertificates, lib/certStatus, lib/dateUtils, StatusPill, Icon, i18n store
 */
import type { CSSProperties } from 'react';
import { useCertificates } from '../../hooks/useCertificates';
import type { ApiCertificate } from '../../api/entities.api';
import { certValidity, CERT_STATE_TONE, type CertValidity } from '../../lib/certStatus';
import { formatDate } from '../../lib/dateUtils';
import { useI18n } from '../../stores/i18n.store';
import { StatusPill } from '../ui/StatusPill';
import { Icon } from '../ui/Icon';

interface Props {
  instanceId: string | null;
  showTitle?: boolean;
}

/** Timeline dot colour per tone (the pill carries the text). */
const DOT_CLASS: Record<'danger' | 'warning' | 'success', string> = {
  danger: 'bg-danger-fg',
  warning: 'bg-warning-fg',
  success: 'bg-success-fg',
};

export function ExpiryTimeline({ instanceId, showTitle = true }: Props) {
  const { t, lang } = useI18n();
  const { data } = useCertificates(instanceId);
  const certs: ApiCertificate[] = Array.isArray(data) ? data : [];

  if (certs.length === 0) return null;

  const sorted = [...certs].sort(
    (a, b) => new Date(a.valid_until).getTime() - new Date(b.valid_until).getTime(),
  );

  function remaining({ state, days }: CertValidity): string {
    if (state === 'expired') return t('expiryTimelineExpired');
    if (days === 0) return t('expiryTimelineToday');
    if (days === 1) return t('expiryTimelineDayLeft');
    return t('expiryTimelineDaysLeft', { n: days });
  }

  return (
    <div>
      {showTitle && (
        <h3 className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold text-[color:var(--text-muted)]">
          <Icon name="event" size={16} />
          {t('expiryTimelineTitle')}
        </h3>
      )}
      <div className="relative pl-3">
        {/* Rail */}
        <span
          aria-hidden="true"
          className="absolute bottom-1 left-[5px] top-1 w-0.5 rounded-full bg-[color:var(--border)]"
        />
        <ol>
          {sorted.map((cert, i) => {
            const validity = certValidity(cert.valid_until);
            const tone = CERT_STATE_TONE[validity.state];
            return (
              <li
                key={cert.id}
                data-cert-state={validity.state}
                className="relative flex animate-list-item-in items-start gap-2.5 py-1.5"
                style={{ '--stagger-index': i } as CSSProperties}
              >
                <span
                  aria-hidden="true"
                  className={`relative z-[1] -ml-1.5 mt-1 h-2.5 w-2.5 flex-shrink-0 rounded-full ring-2 ring-[color:var(--bg-card)] ${DOT_CLASS[tone]}`}
                />
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate text-xs font-semibold text-[color:var(--text-primary)]"
                    title={cert.subject}
                  >
                    {cert.subject}
                  </p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    <time
                      dateTime={cert.valid_until}
                      className="text-[11px] text-[color:var(--text-muted)]"
                    >
                      {formatDate(cert.valid_until, lang)}
                    </time>
                    <StatusPill tone={tone}>{remaining(validity)}</StatusPill>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
