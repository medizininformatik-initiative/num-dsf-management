/**
 * BundlePreview.tsx – Readable preview of the resources this instance
 * contributes to the allow-list bundle (organization, endpoints with their
 * FHIR/BPE addresses, certificates, affiliations). A disclosure button
 * (aria-expanded) reveals the list with a short fade.
 * Dependencies: useOrganization, useEndpoints, useCertificates, useMemberships,
 * lib/dateUtils, lib/parseJsonArray, StatusPill, Icon, i18n store
 */
import { useId, useState, type ReactNode } from 'react';
import { useOrganization } from '../../hooks/useOrganization';
import { useEndpoints } from '../../hooks/useEndpoints';
import { useCertificates } from '../../hooks/useCertificates';
import { useMemberships } from '../../hooks/useMemberships';
import { useI18n } from '../../stores/i18n.store';
import { parseJsonArray } from '../../lib/parseJsonArray';
import { formatDate } from '../../lib/dateUtils';
import { StatusPill } from '../ui/StatusPill';
import { Icon } from '../ui/Icon';

interface Props {
  instanceId: string;
}

interface EndpointRow {
  identifier: string;
  name?: string | null;
  address?: string;
  ipAddresses?: { ip: string; isFhir?: boolean; isBpe?: boolean }[];
}
interface CertificateRow {
  id: string;
  subject: string;
  valid_until: string;
}
interface MembershipRow {
  id: string;
  parent_organization: string;
  roles?: unknown;
}

/** One resource of the bundle: a typed header (decorative icon) and its details. */
function Resource({
  icon,
  iconClass,
  type,
  children,
}: {
  icon: string;
  iconClass: string;
  type: string;
  children: ReactNode;
}) {
  return (
    <li className="border-b border-[color:var(--border)] px-3.5 py-2.5 last:border-b-0">
      <p className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[color:var(--text-secondary)]">
        <Icon name={icon} size={14} className={iconClass} />
        {type}
      </p>
      {children}
    </li>
  );
}

export function BundlePreview({ instanceId }: Props) {
  const { t, lang } = useI18n();
  const listId = useId();
  const [expanded, setExpanded] = useState(false);
  const { data: org } = useOrganization(instanceId);
  const { data: endpointData } = useEndpoints(instanceId);
  const { data: certData } = useCertificates(instanceId);
  const { data: membershipData } = useMemberships(instanceId);
  const endpoints: EndpointRow[] = Array.isArray(endpointData) ? endpointData : [];
  const certs: CertificateRow[] = Array.isArray(certData) ? certData : [];
  const memberships: MembershipRow[] = Array.isArray(membershipData) ? membershipData : [];

  if (!org) return null;

  const resourceCount = 1 + endpoints.length + certs.length + memberships.length;

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-controls={listId}
        className="press-effect flex w-full items-center gap-1.5 rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-card)] px-3 py-2 text-xs font-semibold text-[color:var(--text-secondary)] hover:bg-[color:var(--bg-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus-ring)]"
      >
        <Icon name={expanded ? 'expand_less' : 'preview'} size={16} />
        {expanded ? t('bundlePreviewHide') : t('bundlePreviewShow')}{' '}
        {t('bundlePreviewSuffix', { n: resourceCount })}
      </button>

      {expanded && (
        <ul
          id={listId}
          className="mt-2 animate-fade-in overflow-hidden rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-card)]"
        >
          <Resource
            icon="corporate_fare"
            iconClass="text-primary"
            type={t('bundlePreviewOrganization')}
          >
            <p className="text-xs font-semibold text-[color:var(--text-primary)]">{org.name}</p>
            <p className="mt-0.5 font-mono text-[11px] text-[color:var(--text-muted)]">
              {org.identifier}
            </p>
          </Resource>

          {endpoints.map((ep) => (
            <Resource
              key={ep.identifier}
              icon="hub"
              iconClass="text-teal-600"
              type={t('bundlePreviewEndpoint')}
            >
              <p className="text-xs font-semibold text-[color:var(--text-primary)]">
                {ep.name || ep.identifier}
              </p>
              <p className="mt-0.5 break-all text-[11px] text-[color:var(--text-muted)]">
                {ep.address}
              </p>
              {(ep.ipAddresses ?? []).length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {(ep.ipAddresses ?? []).map((ip, i) => (
                    <StatusPill key={i} tone="neutral" className="font-mono">
                      {[
                        ip.ip,
                        ip.isFhir ? t('bundlePreviewIpFhir') : null,
                        ip.isBpe ? t('bundlePreviewIpBpe') : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </StatusPill>
                  ))}
                </div>
              )}
            </Resource>
          ))}

          {certs.map((cert) => (
            <Resource
              key={cert.id}
              icon="verified_user"
              iconClass="text-amber-600"
              type={t('bundlePreviewCertificate')}
            >
              <p className="break-all text-xs text-[color:var(--text-primary)]">{cert.subject}</p>
              <p className="mt-0.5 text-[11px] text-[color:var(--text-muted)]">
                {t('bundlePreviewValidUntil', {
                  date: formatDate(cert.valid_until, lang) || cert.valid_until,
                })}
              </p>
            </Resource>
          ))}

          {memberships.map((ms) => (
            <Resource
              key={ms.id}
              icon="groups"
              iconClass="text-blue-600"
              type={t('bundlePreviewAffiliation')}
            >
              <p className="text-xs text-[color:var(--text-primary)]">{ms.parent_organization}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {parseJsonArray(ms.roles).map((r) => (
                  <StatusPill key={r} tone="info">
                    {r}
                  </StatusPill>
                ))}
              </div>
            </Resource>
          ))}
        </ul>
      )}
    </div>
  );
}
