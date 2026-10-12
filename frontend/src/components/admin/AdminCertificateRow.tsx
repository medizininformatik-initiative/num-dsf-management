/**
 * AdminCertificateRow.tsx – one admin login certificate as a list row: label
 * or subject, SHA-512 fingerprint (grouped), expiry with a validity pill, last
 * use, and the actions the host supplies (rename, remove). Used by the "My
 * admin certificates" page and the colleague dialog.
 * Dependencies: StatusPill, lib/certStatus, lib/dateUtils, lib/fingerprint, i18n store.
 */
import type { ReactNode } from 'react';
import type { AdminCertificate } from '../../api/adminCertificates.api';
import { StatusPill } from '../ui/StatusPill';
import { certValidity, CERT_STATE_TONE } from '../../lib/certStatus';
import { formatDate, formatDateTime } from '../../lib/dateUtils';
import { fingerprintGroups } from '../../lib/fingerprint';
import { useI18n } from '../../stores/i18n.store';

export function AdminCertificateRow({
  cert,
  current = false,
  actions,
}: {
  cert: AdminCertificate;
  current?: boolean;
  actions?: ReactNode;
}) {
  const { t, lang } = useI18n();
  const validity = cert.validUntil ? certValidity(cert.validUntil) : null;
  return (
    <li className="flex flex-wrap items-start gap-x-4 gap-y-2 border-t border-[color:var(--border)] px-4 py-3 first:border-t-0">
      <div className="min-w-0 flex-1 space-y-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[color:var(--text-primary)]">
          <span className="break-all">{cert.label || cert.subject || t('adminCertUnnamed')}</span>
          {current && (
            <StatusPill tone="info" icon="verified_user">
              {t('adminCertCurrent')}
            </StatusPill>
          )}
        </p>
        {cert.label && cert.subject && (
          <p className="break-all text-xs text-[color:var(--text-secondary)]">{cert.subject}</p>
        )}
        <p className="break-all font-mono text-[11px] text-[color:var(--text-muted)]">
          {fingerprintGroups(cert.fingerprint.slice(0, 32)).join(' ')}…
        </p>
        <p className="text-xs text-[color:var(--text-secondary)]">
          {cert.lastUsedAt
            ? t('adminCertLastUsed', { when: formatDateTime(cert.lastUsedAt, lang) })
            : t('adminCertNeverUsed')}
          {cert.createdBy ? ` · ${t('adminCertAddedBy', { by: cert.createdBy })}` : ''}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {validity && cert.validUntil ? (
          <StatusPill tone={CERT_STATE_TONE[validity.state]}>
            {validity.state === 'expired'
              ? t('adminCertExpiredOn', { date: formatDate(cert.validUntil, lang) })
              : t('adminCertValidUntil', { date: formatDate(cert.validUntil, lang) })}
          </StatusPill>
        ) : (
          <StatusPill tone="neutral">{t('adminCertExpiryUnknown')}</StatusPill>
        )}
        {actions}
      </div>
    </li>
  );
}
