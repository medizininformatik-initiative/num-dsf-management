/**
 * NodeDetailsPanel.tsx – Side sheet over the map showing one organization or
 * a city cluster. Admin view shows all sensitive fields. Non-admin view shows
 * only active/inactive status, certificate status (no exact date), and
 * endpoint names.
 * It slides in from the right on glass (foundation sheet animation) and keeps
 * its last content while sliding out (usePresence). Escape closes it unless a
 * modal dialog is open on top; when it closes with focus inside, focus
 * returns to the pin or list row that opened it. A click on the empty map
 * (GeoMap) also closes it.
 * Dependencies: react, network.api types, i18n.store, usePresence,
 * lib/statusColors, lib/dateUtils, lib/motion, ui/Icon, ui/Button,
 * ui/StatusPill.
 */
import { useEffect, useId, useRef } from 'react';
import type { MapOrganization, MapClusterGroup } from '../../api/network.api';
import { useI18n } from '../../stores/i18n.store';
import { usePresence } from '../../hooks/usePresence';
import { STATUS_COLOR, TONE_CLASS, type StatusTone } from '../../lib/statusColors';
import { formatDate } from '../../lib/dateUtils';
import { exitMs } from '../../lib/motion';
import { Icon } from '../ui/Icon';
import { Button } from '../ui/Button';
import { StatusPill } from '../ui/StatusPill';

const STATUS_LABEL_KEY: Record<
  MapOrganization['cert_status'],
  'mapDetailsCertValid' | 'mapDetailsCertExpiring' | 'mapDetailsCertExpired' | 'mapDetailsCertNone'
> = {
  VALID: 'mapDetailsCertValid',
  EXPIRING: 'mapDetailsCertExpiring',
  EXPIRED: 'mapDetailsCertExpired',
  NONE: 'mapDetailsCertNone',
};

const STATUS_TONE: Record<MapOrganization['cert_status'], StatusTone> = {
  VALID: 'success',
  EXPIRING: 'warning',
  EXPIRED: 'danger',
  NONE: 'neutral',
};

// The sheet leaves on --duration-long-exit.
const EXIT_MS = exitMs('long');

interface Props {
  org: MapOrganization | null;
  cluster: MapClusterGroup | null;
  isAdmin: boolean;
  onClose: () => void;
  onSelectMember: (orgId: string) => void;
}

export function NodeDetailsPanel({ org, cluster, isAdmin, onClose, onSelectMember }: Props) {
  const { t, lang } = useI18n();
  const open = !!org || !!cluster;
  const { mounted, state } = usePresence(open, EXIT_MS);
  const panelRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  // Keep showing the last selection while the sheet slides out.
  const lastShown = useRef({ org, cluster });
  if (open) lastShown.current = { org, cluster };
  const shown = open ? { org, cluster } : lastShown.current;

  // Remember what opened the panel; when it closes with focus inside, send
  // focus back there instead of losing it to <body>.
  useEffect(() => {
    if (!open) return;
    // The <aside> is always rendered, so the node outlives this effect.
    const panel = panelRef.current;
    const active = document.activeElement;
    if (active instanceof HTMLElement && !panel?.contains(active)) {
      openerRef.current = active;
    }
    return () => {
      const focused = document.activeElement;
      const opener = openerRef.current;
      if (
        opener?.isConnected &&
        (focused === document.body || (panel && focused && panel.contains(focused)))
      ) {
        opener.focus();
      }
    };
  }, [open]);

  // Escape closes the panel — but leaves it to a modal dialog stacked on top
  // and to controls that already handled the key.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      if (document.querySelector('[aria-modal="true"]:not([data-state="closed"])')) return;
      onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const closeButton = (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClose}
      aria-label={t('mapCloseDetails')}
      className="h-8 w-8 shrink-0 p-0"
    >
      <Icon name="close" size={20} />
    </Button>
  );

  return (
    <aside
      ref={panelRef}
      aria-hidden={!open}
      aria-labelledby={mounted ? titleId : undefined}
      hidden={!mounted}
      data-state={state}
      className="glass absolute inset-y-0 right-0 z-[2] w-[380px] max-w-full overflow-y-auto rounded-l-2xl border-r-0 data-[state=closed]:pointer-events-none data-[state=open]:animate-sheet-in-right data-[state=closed]:animate-sheet-out-right"
    >
      {mounted && shown.cluster && !shown.org && (
        <div className="flex flex-col gap-3.5 px-[22px] py-5">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 id={titleId} className="m-0 text-lg font-bold text-[color:var(--text-primary)]">
                {shown.cluster.city ?? '—'}
              </h2>
              <p className="mt-1 text-xs text-[color:var(--text-muted)]">
                {t('mapClusterCity', {
                  n: shown.cluster.members.length,
                  city: shown.cluster.city ?? '—',
                })}
              </p>
            </div>
            {closeButton}
          </div>
          <div className="flex flex-col gap-1.5">
            {shown.cluster.members.map((m) => (
              <button
                key={m.identifier}
                type="button"
                onClick={() => onSelectMember(m.identifier)}
                className="press-effect flex items-center gap-2.5 rounded-[10px] border border-[color:var(--border)] bg-[color:var(--bg-hover)] px-3 py-2.5 text-left hover:border-[color:var(--border-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-ring)]"
              >
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: STATUS_COLOR[m.cert_status] }}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold text-[color:var(--text-primary)]">
                    {m.name}
                  </div>
                  <div className="truncate font-mono text-[11px] text-[color:var(--text-muted)]">
                    {m.identifier}
                  </div>
                </div>
                <Icon name="chevron_right" size={16} className="text-[color:var(--text-muted)]" />
              </button>
            ))}
          </div>
        </div>
      )}
      {mounted && shown.org && (
        <OrgDetails
          org={shown.org}
          isAdmin={isAdmin}
          titleId={titleId}
          lang={lang}
          closeButton={closeButton}
        />
      )}
    </aside>
  );
}

function OrgDetails({
  org,
  isAdmin,
  titleId,
  lang,
  closeButton,
}: {
  org: MapOrganization;
  isAdmin: boolean;
  titleId: string;
  lang: 'de' | 'en';
  closeButton: React.ReactNode;
}) {
  const { t } = useI18n();
  const tone = STATUS_TONE[org.cert_status];
  const expired = org.cert_status === 'EXPIRED';
  return (
    <div className="flex flex-col gap-4 px-[22px] py-5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id={titleId} className="m-0 text-lg font-bold text-[color:var(--text-primary)]">
            {org.name}
          </h2>
          <p className="mt-1 break-all font-mono text-xs text-brand-700 dark:text-brand-400">
            {org.identifier}
          </p>
        </div>
        {closeButton}
      </div>

      <StatusPill
        tone={org.active ? 'success' : 'neutral'}
        icon={org.active ? 'check_circle' : 'pause_circle'}
        className="self-start uppercase tracking-wide"
      >
        {t(org.active ? 'mapDetailsActive' : 'mapDetailsInactive')}
      </StatusPill>

      <div
        className={`flex items-center gap-2 rounded-[10px] border px-3 py-2 text-xs font-semibold ${TONE_CLASS[tone]}`}
      >
        <Icon name="verified_user" size={16} />
        {t('mapDetailsCertLabel')}: {t(STATUS_LABEL_KEY[org.cert_status])}
        {isAdmin && org.next_cert_expiry && (
          <span className="ml-auto text-[11px] font-medium">
            {formatDate(org.next_cert_expiry, lang)}
          </span>
        )}
      </div>

      {(org.cert_status === 'EXPIRING' || expired) && (
        <div
          className={`flex items-start gap-2 rounded-[10px] border px-3 py-2.5 ${TONE_CLASS[tone]}`}
        >
          <Icon name={expired ? 'error' : 'warning'} size={18} className="shrink-0" />
          <div className="text-xs">
            {t(expired ? 'mapDetailsExpiredText' : 'mapDetailsExpiringText')}
            {isAdmin && typeof org.cert_days_until === 'number' && (
              <div className="mt-1 font-semibold">
                {org.cert_days_until < 0
                  ? Math.abs(org.cert_days_until) === 1
                    ? t('mapDetailsExpiredAgoOne')
                    : t('mapDetailsExpiredAgoMany', { n: Math.abs(org.cert_days_until) })
                  : org.cert_days_until === 1
                    ? t('mapDetailsDayRemainingOne')
                    : t('mapDetailsDaysRemainingMany', { n: org.cert_days_until })}
              </div>
            )}
          </div>
        </div>
      )}

      <Section title={`${t('mapDetailsEndpoints')} (${org.endpoints.length})`}>
        {org.endpoints.length === 0 && <Empty>{t('mapDetailsNoEndpoints')}</Empty>}
        {org.endpoints.map((ep) => {
          const adminEp = isAdmin && 'address' in ep ? ep : null;
          return (
            <Item key={ep.identifier}>
              <div className="text-xs font-semibold text-[color:var(--text-primary)]">
                {ep.name ?? ep.identifier}
              </div>
              {adminEp && (
                <div className="break-all font-mono text-[11px] text-[color:var(--text-secondary)]">
                  {adminEp.address}
                </div>
              )}
              {adminEp && adminEp.ips.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {adminEp.ips.map((ip, i) => (
                    <span
                      key={i}
                      className={`rounded border px-1.5 font-mono text-[11px] ${TONE_CLASS.neutral}`}
                    >
                      {ip.ip}
                      {ip.is_fhir ? ' · FHIR' : ''}
                      {ip.is_bpe ? ' · BPE' : ''}
                    </span>
                  ))}
                </div>
              )}
            </Item>
          );
        })}
      </Section>

      {isAdmin && org.contacts && (
        <Section title={`${t('mapDetailsContacts')} (${org.contacts.length})`}>
          {org.contacts.length === 0 && <Empty>{t('mapDetailsNoContacts')}</Empty>}
          {org.contacts.map((c, i) => (
            <Item key={i}>
              <div className="text-xs font-semibold text-[color:var(--text-primary)]">
                {c.name ?? '—'}
              </div>
              <div className="text-[11px] text-[color:var(--text-secondary)]">{c.email}</div>
              {c.types.length > 0 && (
                <div className="mt-0.5 text-[11px] text-[color:var(--text-secondary)]">
                  {c.types.join(', ')}
                </div>
              )}
            </Item>
          ))}
        </Section>
      )}

      <Section title={`${t('mapDetailsMemberships')} (${org.memberships.length})`}>
        {org.memberships.length === 0 && <Empty>{t('mapDetailsNoMemberships')}</Empty>}
        {org.memberships.map((m, i) => {
          const adminM = isAdmin && 'endpoint_id' in m ? m : null;
          return (
            <Item key={i}>
              <div className="text-xs font-semibold text-[color:var(--text-primary)]">
                {m.parent_organization}
              </div>
              {m.roles.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {m.roles.map((role, j) => (
                    <span
                      key={j}
                      className={`rounded border px-1.5 text-[11px] font-bold ${TONE_CLASS.info}`}
                    >
                      {role}
                    </span>
                  ))}
                </div>
              )}
              {adminM && adminM.endpoint_id && (
                <div className="mt-0.5 font-mono text-[11px] text-[color:var(--text-muted)]">
                  {adminM.endpoint_id}
                </div>
              )}
            </Item>
          );
        })}
      </Section>

      {isAdmin && (org.city || org.country_code || org.email) && (
        <Section title={t('mapDetailsLocation')}>
          <Row label={t('mapDetailsCity')} value={org.city ?? '—'} />
          <Row label={t('mapDetailsCountry')} value={org.country_code ?? '—'} />
          <Row label={t('mapDetailsEmail')} value={org.email ?? '—'} />
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-[color:var(--text-muted)]">
        {title}
      </div>
      {children}
    </div>
  );
}

function Item({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 rounded-lg bg-[color:var(--bg-hover)] px-2.5 py-2">{children}</div>;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-1 flex gap-2 text-xs">
      <span className="min-w-[60px] text-[color:var(--text-muted)]">{label}</span>
      <span className="text-[color:var(--text-primary)]">{value}</span>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-xs italic text-[color:var(--text-muted)]">{children}</div>;
}
