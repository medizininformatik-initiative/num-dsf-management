/**
 * SnapshotView.tsx — Read-only viewer for an approval-request data snapshot.
 * Renders the quick change-count summary and the per-entity detail grid.
 * Extracted from RequestCard.tsx (project 500-line file limit); pure
 * presentation driven by a parsed SnapshotData. Entity colours only tint the
 * section icons and accent borders; all text uses theme tokens with AA
 * contrast in light and dark mode.
 *
 * Dependencies: parseSnapshot (SnapshotData type), useI18n (translate fn type,
 * app language for dates), lib/dateUtils, StatusPill, Icon.
 */
import type { ReactNode } from 'react';
import type { SnapshotData } from './parseSnapshot';
import type { TranslationKey } from '../../i18n/en';
import { useI18n } from '../../stores/i18n.store';
import { formatDate } from '../../lib/dateUtils';
import { StatusPill } from '../ui/StatusPill';
import { Icon } from '../ui/Icon';

type TranslateFn = (key: TranslationKey, params?: Record<string, string | number>) => string;

/** Entity accent colours (icons and borders only, never text). */
const ACCENT = {
  organization: 'var(--accent)',
  endpoints: '#3ecfb2',
  certificates: '#f5a623',
  memberships: '#4a90d9',
  contacts: '#8b5cf6',
} as const;

const CHIP_CLASS =
  'rounded bg-[color:var(--bg-hover)] px-1.5 py-px font-mono text-[11px] text-[color:var(--text-secondary)]';

export function SnapshotView({ snapshot, t }: { snapshot: SnapshotData; t: TranslateFn }) {
  const { lang } = useI18n();
  const endpoints = snapshot.endpoints ?? [];
  const certificates = snapshot.certificates ?? [];
  const memberships = snapshot.memberships ?? [];
  const contacts = snapshot.contacts ?? [];

  return (
    <>
      {/* Quick change summary */}
      {snapshot.organization && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          <StatusPill icon="dns">
            {t('requestCardCountEndpoints', { n: endpoints.length })}
          </StatusPill>
          <StatusPill icon="verified_user">
            {t('requestCardCountCertificates', { n: certificates.length })}
          </StatusPill>
          <StatusPill icon="group_work">
            {t('requestCardCountMemberships', { n: memberships.length })}
          </StatusPill>
          <StatusPill icon="contacts">
            {t('requestCardCountContacts', { n: contacts.length })}
          </StatusPill>
        </div>
      )}

      {/* Snapshot viewer */}
      <div className="grid gap-3 sm:grid-cols-2">
        {/* Organization */}
        <SnapshotSection
          title={t('organization')}
          color={ACCENT.organization}
          icon="corporate_fare"
        >
          {snapshot.organization ? (
            <div className="flex flex-col gap-1">
              <SnapshotField label={t('orgCardName')} value={snapshot.organization.name} />
              <SnapshotField
                label={t('requestCardFieldId')}
                value={snapshot.organization.identifier}
                mono
              />
              {snapshot.organization.email && (
                <SnapshotField
                  label={t('orgCardEmail')}
                  value={String(snapshot.organization.email)}
                />
              )}
              {snapshot.organization.city && (
                <SnapshotField
                  label={t('orgCardCity')}
                  value={String(snapshot.organization.city)}
                />
              )}
              {snapshot.organization.country_code && (
                <SnapshotField
                  label={t('mapDetailsCountry')}
                  value={String(snapshot.organization.country_code)}
                />
              )}
            </div>
          ) : (
            <EmptyNote>{t('adminSnapshotNoOrg')}</EmptyNote>
          )}
        </SnapshotSection>

        {/* Endpoints */}
        <SnapshotSection
          title={t('requestCardSectionEndpoints', { n: endpoints.length })}
          color={ACCENT.endpoints}
          icon="dns"
        >
          {endpoints.length > 0 ? (
            <div className="flex flex-col gap-2">
              {endpoints.map((ep, i) => (
                <AccentItem key={i} color={ACCENT.endpoints}>
                  <div className="text-xs font-semibold text-[color:var(--text-primary)]">
                    {ep.name ?? ep.identifier ?? '—'}
                  </div>
                  <div className="break-all font-mono text-[11px] text-[color:var(--text-muted)]">
                    {ep.address}
                  </div>
                  {ep.ips && ep.ips.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {ep.ips.map((ip, j) => (
                        <span key={j} className={CHIP_CLASS}>
                          {ip.ip}
                          {ip.is_fhir ? ' [FHIR]' : ''}
                          {ip.is_bpe ? ' [BPE]' : ''}
                        </span>
                      ))}
                    </div>
                  )}
                </AccentItem>
              ))}
            </div>
          ) : (
            <EmptyNote>{t('adminSnapshotNoEndpoints')}</EmptyNote>
          )}
        </SnapshotSection>

        {/* Certificates */}
        <SnapshotSection
          title={t('requestCardSectionCertificates', { n: certificates.length })}
          color={ACCENT.certificates}
          icon="verified_user"
        >
          {certificates.length > 0 ? (
            <div className="flex flex-col gap-2">
              {certificates.map((cert, i) => (
                <AccentItem key={i} color={ACCENT.certificates}>
                  <div className="break-all text-xs font-semibold text-[color:var(--text-primary)]">
                    {cert.subject ?? '—'}
                  </div>
                  {cert.thumbprint && (
                    <div className="break-all font-mono text-[11px] text-[color:var(--text-muted)]">
                      {cert.thumbprint}
                    </div>
                  )}
                  {cert.valid_until && (
                    <div className="text-[11px] text-[color:var(--text-secondary)]">
                      {t('adminSnapshotExpires', {
                        date: formatDate(cert.valid_until, lang) || cert.valid_until,
                      })}
                    </div>
                  )}
                </AccentItem>
              ))}
            </div>
          ) : (
            <EmptyNote>{t('adminSnapshotNoCerts')}</EmptyNote>
          )}
        </SnapshotSection>

        {/* Memberships */}
        <SnapshotSection
          title={t('requestCardSectionMemberships', { n: memberships.length })}
          color={ACCENT.memberships}
          icon="group_work"
        >
          {memberships.length > 0 ? (
            <div className="flex flex-col gap-2">
              {memberships.map((m, i) => (
                <AccentItem key={i} color={ACCENT.memberships}>
                  <div className="text-xs font-semibold text-[color:var(--text-primary)]">
                    {m.parent_organization ?? '—'}
                  </div>
                  {m.roles && m.roles.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {m.roles.map((role, j) => (
                        <StatusPill key={j} tone="info">
                          {role}
                        </StatusPill>
                      ))}
                    </div>
                  )}
                  {m.endpoint_id && (
                    <div className="mt-0.5 font-mono text-[11px] text-[color:var(--text-muted)]">
                      {m.endpoint_id}
                    </div>
                  )}
                </AccentItem>
              ))}
            </div>
          ) : (
            <EmptyNote>{t('adminSnapshotNoMemberships')}</EmptyNote>
          )}
        </SnapshotSection>

        {/* Contacts — spans full width if present */}
        {contacts.length > 0 && (
          <div className="sm:col-span-2">
            <SnapshotSection
              title={t('requestCardSectionContacts', { n: contacts.length })}
              color={ACCENT.contacts}
              icon="contacts"
            >
              <div className="flex flex-wrap gap-2">
                {contacts.map((c, i) => (
                  <div
                    key={i}
                    className="min-w-[10rem] rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-hover)] px-2.5 py-1.5"
                  >
                    <div className="text-xs font-semibold text-[color:var(--text-primary)]">
                      {c.name ?? '—'}
                    </div>
                    <div className="text-[11px] text-[color:var(--text-secondary)]">{c.email}</div>
                    {c.types && c.types.length > 0 && (
                      <div className="mt-0.5 text-[11px] text-[color:var(--text-muted)]">
                        {c.types.join(', ')}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </SnapshotSection>
          </div>
        )}
      </div>
    </>
  );
}

function SnapshotSection({
  title,
  color,
  icon,
  children,
}: {
  title: string;
  color: string;
  icon: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-card)] px-4 py-3.5">
      <h3 className="mb-2.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[color:var(--text-secondary)]">
        <Icon name={icon} size={16} style={{ color }} />
        {title}
      </h3>
      {children}
    </section>
  );
}

function AccentItem({ color, children }: { color: string; children: ReactNode }) {
  return (
    <div className="border-l-[3px] pl-2" style={{ borderColor: color }}>
      {children}
    </div>
  );
}

function SnapshotField({
  label,
  value,
  mono,
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="min-w-[3.25rem] text-[11px] text-[color:var(--text-muted)]">{label}</span>
      <span
        className={`break-all text-xs text-[color:var(--text-primary)] ${mono ? 'font-mono' : ''}`}
      >
        {value ?? '—'}
      </span>
    </div>
  );
}

function EmptyNote({ children }: { children: ReactNode }) {
  return <span className="text-xs italic text-[color:var(--text-muted)]">{children}</span>;
}
