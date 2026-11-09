/**
 * NodeDetailsPanel.tsx – Glass sheet over the map showing one organization or
 * a city cluster. Admin view shows all sensitive fields. Non-admin view shows
 * only active/inactive status, certificate status (no exact date), and
 * endpoint names.
 * Hierarchy: avatar with status ring, name and identifier; activity pill; the
 * certificate card in its status tone (validity date and remaining days for
 * admins); then grouped sections (endpoints with their address link and IPs,
 * contacts, memberships with Verbund colour and roles, location with a mail
 * link). Sections cascade in with a short stagger, and switching organizations
 * crossfades the content.
 * The sheet docks on `side` (right/left on wide screens, bottom below 1024px)
 * and slides in from that edge, keeping its last content and side while it
 * slides out (usePresence). Escape closes it unless a modal dialog is open on
 * top; when it closes with focus inside, focus returns to the pin or list row
 * that opened it. A click on the empty map (GeoMap) also closes it.
 * Dependencies: react, network.api types, i18n.store, usePresence,
 * lib/statusColors, lib/peerEdges, lib/dateUtils, lib/motion, ui/Icon,
 * ui/Button, ui/StatusPill, mapGeometry (initials), map.css.
 */
import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from 'react';
import type { MapOrganization, MapClusterGroup } from '../../api/network.api';
import { useI18n } from '../../stores/i18n.store';
import { usePresence } from '../../hooks/usePresence';
import { CERT_STATUS_TONE, TONE_CLASS, certStatusColor } from '../../lib/statusColors';
import { verbundColor } from '../../lib/peerEdges';
import { formatDate } from '../../lib/dateUtils';
import { exitMs } from '../../lib/motion';
import { Icon } from '../ui/Icon';
import { Button } from '../ui/Button';
import { StatusPill } from '../ui/StatusPill';
import { initialsOf } from './mapGeometry';

const STATUS_LABEL_KEY: Record<
  MapOrganization['cert_status'],
  'mapDetailsCertValid' | 'mapDetailsCertExpiring' | 'mapDetailsCertExpired' | 'mapDetailsCertNone'
> = {
  VALID: 'mapDetailsCertValid',
  EXPIRING: 'mapDetailsCertExpiring',
  EXPIRED: 'mapDetailsCertExpired',
  NONE: 'mapDetailsCertNone',
};

export type SheetSide = 'left' | 'right' | 'bottom';

const SIDE_CLASS: Record<SheetSide, string> = {
  right: 'right-3 top-3 bottom-3 w-[380px] max-w-[calc(100%-24px)]',
  left: 'left-3 top-3 bottom-3 w-[380px] max-w-[calc(100%-24px)]',
  bottom: 'inset-x-3 bottom-3 max-h-[calc(50%-12px)]',
};

// The sheet leaves on --duration-long-exit.
const EXIT_MS = exitMs('long');

interface Props {
  org: MapOrganization | null;
  cluster: MapClusterGroup | null;
  isAdmin: boolean;
  onClose: () => void;
  onSelectMember: (orgId: string) => void;
  side?: SheetSide;
}

function stagger(i: number): CSSProperties {
  return { '--stagger-index': i } as CSSProperties;
}

export function NodeDetailsPanel({
  org,
  cluster,
  isAdmin,
  onClose,
  onSelectMember,
  side = 'right',
}: Props) {
  const { t, lang } = useI18n();
  const open = !!org || !!cluster;
  const { mounted, state } = usePresence(open, EXIT_MS);
  const panelRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  // Keep showing the last selection (and its side) while the sheet slides out.
  const lastShown = useRef({ org, cluster, side });
  if (open) lastShown.current = { org, cluster, side };
  const shown = open ? { org, cluster, side } : lastShown.current;

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
      className="h-8 w-8 shrink-0 rounded-full p-0"
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
      data-side={shown.side}
      className={`glass-thick absolute z-[4] overflow-y-auto rounded-card data-[state=closed]:pointer-events-none ${SIDE_CLASS[shown.side]} map-animate-sheet-${state === 'open' ? 'in' : 'out'}-${shown.side}`}
    >
      {mounted && shown.cluster && !shown.org && (
        <div
          key={`cluster-${shown.cluster.city}`}
          className="flex animate-fade-in flex-col gap-4 p-5"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-3">
              <span
                aria-hidden="true"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 bg-[color:var(--bg-card)] text-[15px] font-bold text-[color:var(--text-primary)]"
                style={{ borderColor: certStatusColor(shown.cluster.worstStatus) }}
              >
                {shown.cluster.members.length}
              </span>
              <div className="min-w-0">
                <h2
                  id={titleId}
                  className="m-0 truncate text-lg font-semibold text-[color:var(--text-primary)]"
                >
                  {shown.cluster.city ?? '—'}
                </h2>
                <p className="m-0 mt-0.5 text-xs text-[color:var(--text-secondary)]">
                  {t('mapClusterCity', {
                    n: shown.cluster.members.length,
                    city: shown.cluster.city ?? '—',
                  })}
                </p>
              </div>
            </div>
            {closeButton}
          </div>
          <Group>
            {shown.cluster.members.map((m, i) => (
              <button
                key={m.identifier}
                type="button"
                onClick={() => onSelectMember(m.identifier)}
                style={stagger(i)}
                className="press-effect flex w-full animate-list-item-in items-center gap-3 px-3 py-2.5 text-left transition-colors duration-short hover:bg-[color:var(--bg-card)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--focus-ring)]"
              >
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: certStatusColor(m.cert_status) }}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-[color:var(--text-primary)]">
                    {m.name}
                  </div>
                  <div className="truncate font-mono text-[11px] text-[color:var(--text-secondary)]">
                    {m.identifier}
                  </div>
                </div>
                <Icon name="chevron_right" size={18} className="text-[color:var(--text-muted)]" />
              </button>
            ))}
          </Group>
        </div>
      )}
      {mounted && shown.org && (
        <OrgDetails
          key={shown.org.identifier}
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
  closeButton: ReactNode;
}) {
  const { t } = useI18n();
  const tone = CERT_STATUS_TONE[org.cert_status];
  const expired = org.cert_status === 'EXPIRED';
  const warn = org.cert_status === 'EXPIRING' || expired;
  let section = 0;
  return (
    <div className="flex animate-fade-in flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 bg-[color:var(--bg-card)] text-[13px] font-bold text-[color:var(--text-primary)]"
            style={{
              borderColor: certStatusColor(org.cert_status),
              borderStyle: org.active ? 'solid' : 'dashed',
            }}
          >
            {initialsOf(org)}
          </span>
          <div className="min-w-0">
            <h2
              id={titleId}
              className="m-0 text-lg font-semibold leading-snug text-[color:var(--text-primary)]"
            >
              {org.name}
            </h2>
            <p className="m-0 mt-0.5 break-all font-mono text-xs text-brand-700 dark:text-brand-400">
              {org.identifier}
            </p>
          </div>
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
        style={stagger(section++)}
        className={`animate-list-item-in rounded-control border px-3.5 py-3 ${TONE_CLASS[tone]}`}
      >
        <div className="flex items-center gap-2 text-[13px] font-semibold">
          <Icon name={expired ? 'error' : warn ? 'warning' : 'verified_user'} size={18} />
          {t('mapDetailsCertLabel')}: {t(STATUS_LABEL_KEY[org.cert_status])}
          {isAdmin && org.next_cert_expiry && (
            <span className="ml-auto text-xs font-medium">
              {formatDate(org.next_cert_expiry, lang)}
            </span>
          )}
        </div>
        {warn && (
          <div className="mt-1.5 text-xs leading-relaxed">
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
        )}
      </div>

      <Section title={`${t('mapDetailsEndpoints')} (${org.endpoints.length})`} index={section++}>
        {org.endpoints.length === 0 && <Empty>{t('mapDetailsNoEndpoints')}</Empty>}
        {org.endpoints.length > 0 && (
          <Group>
            {org.endpoints.map((ep) => {
              const adminEp = isAdmin && 'address' in ep ? ep : null;
              return (
                <Item key={ep.identifier}>
                  <div className="text-[13px] font-semibold text-[color:var(--text-primary)]">
                    {ep.name ?? ep.identifier}
                  </div>
                  {adminEp &&
                    (/^https:\/\//i.test(adminEp.address) ? (
                      <a
                        href={adminEp.address}
                        target="_blank"
                        rel="noreferrer noopener"
                        aria-label={`${adminEp.address} — ${t('mapDetailsOpensNewTab')}`}
                        className="mt-0.5 inline-flex max-w-full items-center gap-1 break-all font-mono text-[11px] text-[color:var(--text-secondary)] underline-offset-2 hover:text-[color:var(--text-primary)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-ring)]"
                      >
                        {adminEp.address}
                        <Icon name="open_in_new" size={12} className="shrink-0" />
                      </a>
                    ) : (
                      <div className="mt-0.5 break-all font-mono text-[11px] text-[color:var(--text-secondary)]">
                        {adminEp.address}
                      </div>
                    ))}
                  {adminEp && adminEp.ips.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {adminEp.ips.map((ip, i) => (
                        <span
                          key={i}
                          className={`rounded-small border px-1.5 font-mono text-[11px] ${TONE_CLASS.neutral}`}
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
          </Group>
        )}
      </Section>

      {isAdmin && org.contacts && (
        <Section title={`${t('mapDetailsContacts')} (${org.contacts.length})`} index={section++}>
          {org.contacts.length === 0 && <Empty>{t('mapDetailsNoContacts')}</Empty>}
          {org.contacts.length > 0 && (
            <Group>
              {org.contacts.map((c, i) => (
                <Item key={i}>
                  <div className="text-[13px] font-semibold text-[color:var(--text-primary)]">
                    {c.name ?? '—'}
                  </div>
                  <MailLink email={c.email} />
                  {c.types.length > 0 && (
                    <div className="mt-0.5 text-[11px] text-[color:var(--text-secondary)]">
                      {c.types.join(', ')}
                    </div>
                  )}
                </Item>
              ))}
            </Group>
          )}
        </Section>
      )}

      <Section
        title={`${t('mapDetailsMemberships')} (${org.memberships.length})`}
        index={section++}
      >
        {org.memberships.length === 0 && <Empty>{t('mapDetailsNoMemberships')}</Empty>}
        {org.memberships.length > 0 && (
          <Group>
            {org.memberships.map((m, i) => {
              const adminM = isAdmin && 'endpoint_id' in m ? m : null;
              return (
                <Item key={i}>
                  <div className="flex items-center gap-2 text-[13px] font-semibold text-[color:var(--text-primary)]">
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: verbundColor(m.parent_organization) }}
                    />
                    <span className="min-w-0 break-all">{m.parent_organization}</span>
                  </div>
                  {m.roles.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {m.roles.map((role, j) => (
                        <span
                          key={j}
                          className={`rounded-small border px-1.5 text-[11px] font-bold ${TONE_CLASS.info}`}
                        >
                          {role}
                        </span>
                      ))}
                    </div>
                  )}
                  {adminM && adminM.endpoint_id && (
                    <div className="mt-1 font-mono text-[11px] text-[color:var(--text-secondary)]">
                      {adminM.endpoint_id}
                    </div>
                  )}
                </Item>
              );
            })}
          </Group>
        )}
      </Section>

      {isAdmin && (org.city || org.country_code || org.email) && (
        <Section title={t('mapDetailsLocation')} index={section++}>
          <Group>
            <Row label={t('mapDetailsCity')}>{org.city ?? '—'}</Row>
            <Row label={t('mapDetailsCountry')}>{org.country_code ?? '—'}</Row>
            <Row label={t('mapDetailsEmail')}>
              {org.email ? <MailLink email={org.email} /> : '—'}
            </Row>
          </Group>
        </Section>
      )}
    </div>
  );
}

function Section({
  title,
  index,
  children,
}: {
  title: string;
  index: number;
  children: ReactNode;
}) {
  return (
    <section style={stagger(index)} className="animate-list-item-in">
      <h3 className="m-0 mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-[color:var(--text-secondary)]">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** iOS-style inset group: one rounded surface, hairlines between items. */
function Group({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-[color:var(--border)] overflow-hidden rounded-control border border-[color:var(--border)] bg-[color:var(--bg-hover)]">
      {children}
    </div>
  );
}

function Item({ children }: { children: ReactNode }) {
  return <div className="px-3 py-2.5">{children}</div>;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 px-3 py-2 text-xs">
      <span className="min-w-[64px] text-[color:var(--text-secondary)]">{label}</span>
      <span className="min-w-0 break-all text-[color:var(--text-primary)]">{children}</span>
    </div>
  );
}

function MailLink({ email }: { email: string }) {
  return (
    <a
      href={`mailto:${email}`}
      className="text-[12px] text-[color:var(--text-secondary)] underline-offset-2 hover:text-[color:var(--text-primary)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-ring)]"
    >
      {email}
    </a>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="px-1 text-xs italic text-[color:var(--text-secondary)]">{children}</div>;
}
