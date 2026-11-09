/**
 * BundlePreview.tsx – Readable FHIR Bundle preview: a disclosure listing the
 * organization, endpoints, certificates and affiliations that the bundle
 * contains, one icon-led row each (theme tokens, no hard-coded colours).
 * Dependencies: useOrganization, useEndpoints, useCertificates, useMemberships, Icon
 */
import { useState } from 'react';
import { useOrganization } from '../../hooks/useOrganization';
import { useEndpoints } from '../../hooks/useEndpoints';
import { useCertificates } from '../../hooks/useCertificates';
import { useMemberships } from '../../hooks/useMemberships';
import { useI18n } from '../../stores/i18n.store';
import { parseJsonArray } from '../../lib/parseJsonArray';
import { formatDate } from '../../lib/dateUtils';
import { Icon } from '../ui/Icon';

interface Props {
  instanceId: string;
}

function Row({ icon, kind, children }: { icon: string; kind: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 border-b border-[color:var(--border)] px-3 py-2.5 last:border-b-0">
      <Icon name={icon} size={16} className="shrink-0 text-[color:var(--text-muted)]" />
      <div className="min-w-0">
        <p className="text-2xs font-medium text-[color:var(--text-muted)]">{kind}</p>
        {children}
      </div>
    </div>
  );
}

export function BundlePreview({ instanceId }: Props) {
  const { t, lang } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const { data: org } = useOrganization(instanceId);
  const { data: endpoints = [] } = useEndpoints(instanceId);
  const { data: certs = [] } = useCertificates(instanceId);
  const { data: memberships = [] } = useMemberships(instanceId);

  if (!org) return null;

  const resourceCount = 1 + endpoints.length + certs.length + memberships.length;
  const primary = 'text-sm font-medium text-[color:var(--text-primary)]';
  const muted = 'text-xs text-[color:var(--text-muted)]';

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="press-effect flex w-full items-center gap-2 rounded-control border border-[color:var(--border)] bg-[color:var(--bg-card)] px-3 py-2 text-xs font-semibold text-[color:var(--text-secondary)] hover:border-[color:var(--border-strong)] hover:bg-[color:var(--bg-hover)] hover:text-[color:var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-ring)]"
      >
        <Icon name={expanded ? 'expand_less' : 'preview'} size={14} />
        {expanded ? t('bundlePreviewHide') : t('bundlePreviewShow')}{' '}
        {t('bundlePreviewSuffix', { n: resourceCount })}
      </button>

      {expanded && (
        <div className="mt-2 overflow-hidden rounded-control bg-[color:var(--bg-hover)]">
          <Row icon="corporate_fare" kind={t('bundlePreviewOrganization')}>
            <p className={primary}>{org.name}</p>
            <p className={`${muted} font-mono`}>{org.identifier}</p>
          </Row>

          {endpoints.map(
            (ep: {
              identifier: string;
              name?: string;
              address?: string;
              ipAddresses?: Array<{ ip: string; isFhir?: boolean; isBpe?: boolean }>;
            }) => (
              <Row key={ep.identifier} icon="hub" kind={t('bundlePreviewEndpoint')}>
                <p className={primary}>{ep.name || ep.identifier}</p>
                <p className={`${muted} break-all`}>{ep.address}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {(ep.ipAddresses || []).map((ip, i) => (
                    <span
                      key={i}
                      className="pill bg-neutral-surface border-neutral-border text-neutral-fg"
                    >
                      {ip.ip}
                      {ip.isFhir ? ` · ${t('bundlePreviewIpFhir')}` : ''}
                      {ip.isBpe ? ` · ${t('bundlePreviewIpBpe')}` : ''}
                    </span>
                  ))}
                </div>
              </Row>
            ),
          )}

          {certs.map((cert: { id: string; subject?: string; valid_until?: string }) => (
            <Row key={cert.id} icon="verified_user" kind={t('bundlePreviewCertificate')}>
              <p className={primary}>{cert.subject}</p>
              <p className={muted}>
                {t('bundlePreviewValidUntil', {
                  date: cert.valid_until ? formatDate(cert.valid_until, lang) : '',
                })}
              </p>
            </Row>
          ))}

          {memberships.map((ms: { id: string; parent_organization: string; roles: unknown }) => (
            <Row key={ms.id} icon="groups" kind={t('bundlePreviewAffiliation')}>
              <p className={primary}>{ms.parent_organization}</p>
              <p className={`${muted} flex flex-wrap gap-2`}>
                {parseJsonArray(ms.roles).map((r) => (
                  <span key={r}>{r}</span>
                ))}
              </p>
            </Row>
          ))}
        </div>
      )}
    </div>
  );
}
