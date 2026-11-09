/**
 * ApprovalModal.tsx — review-and-submit dialog for an instance approval request.
 * While a request is PENDING the dialog is the "Running request" view
 * (ApprovalRunningRequest) with a confirmed "Withdraw request" action instead
 * of a second submit. Otherwise the latest request leads (ApprovalStatusBanner;
 * a rejection shows its reason). The checklist is the shared readiness rule (deriveReadiness, as in
 * the wizard and the right panel); an open item closes the dialog and jumps to
 * its card. Below, the data the request will snapshot. Submits through the
 * cross-user guard; backend refusals map to translated messages.
 * Dependencies: Modal, Callout, Button, Icon, StatusPill, ApprovalStatusBanner,
 * lib/readiness, lib/certStatus, lib/dateUtils, entity hooks, useApproval,
 * useCrossUserGuard, i18n store.
 */
import { useId, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Modal } from './Modal';
import { parseJsonArray } from '../../lib/parseJsonArray';
import {
  useApprovalStatus,
  useSubmitApproval,
  useWithdrawApproval,
  type ApprovalStatus,
} from '../../hooks/useApproval';
import { useConfirm } from '../../hooks/useConfirm';
import { ApprovalRunningRequest } from './ApprovalRunningRequest';
import { ApprovalHistoryList } from './ApprovalHistoryList';
import { useOrganization } from '../../hooks/useOrganization';
import { useContacts } from '../../hooks/useContacts';
import { useEndpoints } from '../../hooks/useEndpoints';
import { useCertificates } from '../../hooks/useCertificates';
import { useMemberships } from '../../hooks/useMemberships';
import { useCrossUserGuard } from '../../hooks/useCrossUserGuard';
import { useI18n } from '../../stores/i18n.store';
import { getErrorCode, getErrorMessage } from '../../lib/getErrorMessage';
import {
  deriveReadiness,
  READINESS_ICON,
  READINESS_LABEL,
  revealReadinessCard,
  type ReadinessKey,
} from '../../lib/readiness';
import { certValidity } from '../../lib/certStatus';
import { formatDate } from '../../lib/dateUtils';
import { ApprovalStatusBanner } from '../layout/ApprovalStatusBanner';
import { Callout } from './Callout';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { StatusPill } from '../ui/StatusPill';

interface ContactRow {
  id: string;
  name?: string | null;
  types?: unknown;
  email_validated?: boolean | number | null;
}
interface EndpointRow {
  identifier: string;
  name?: string | null;
  address?: string;
  ipAddresses?: { id?: string; ip: string }[];
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

function Section({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  return (
    <div className="overflow-hidden rounded-control border border-[color:var(--border)]">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={bodyId}
        className="flex w-full items-center justify-between bg-[color:var(--bg-hover)] px-3 py-2.5 text-left transition-colors duration-short ease-standard hover:bg-[color:var(--border)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--focus-ring)]"
      >
        <span className="text-sm font-semibold text-[color:var(--text-primary)]">{title}</span>
        <Icon
          name="expand_more"
          size={16}
          className={`text-[color:var(--text-muted)] transition-transform duration-medium ease-spring ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div id={bodyId} className="animate-fade-in space-y-2 p-3">
          {children}
        </div>
      )}
    </div>
  );
}

function KV({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[color:var(--border)] py-1.5 text-xs last:border-0">
      <span className="font-medium text-[color:var(--text-muted)]">{k}</span>
      <span className="text-right font-semibold text-[color:var(--text-primary)]">{v}</span>
    </div>
  );
}

const itemBox = 'rounded-control bg-[color:var(--bg-hover)] px-3 py-2';
const itemName = 'text-sm font-medium text-[color:var(--text-primary)]';
/** Meta line of an item, and the note of an empty section. */
const muted = 'text-xs text-[color:var(--text-muted)]';

interface Props {
  open: boolean;
  onClose: () => void;
  instanceId: string;
}

export function ApprovalModal({ open, onClose, instanceId }: Props) {
  const { t, lang } = useI18n();
  const { mutateAsync, isPending } = useSubmitApproval(instanceId);
  const guard = useCrossUserGuard();
  const statusQuery = useApprovalStatus(instanceId);
  const approval: ApprovalStatus | null | undefined = statusQuery.data;
  const running = approval?.status === 'PENDING';
  const { mutateAsync: withdraw, isPending: withdrawing } = useWithdrawApproval(instanceId);
  const confirm = useConfirm();
  const { data: org } = useOrganization(instanceId);
  const { data: contactData } = useContacts(instanceId);
  const { data: endpointData } = useEndpoints(instanceId);
  const { data: certData } = useCertificates(instanceId);
  const { data: membershipData } = useMemberships(instanceId);
  const contacts: ContactRow[] = Array.isArray(contactData) ? contactData : [];
  const endpoints: EndpointRow[] = Array.isArray(endpointData) ? endpointData : [];
  const certs: CertificateRow[] = Array.isArray(certData) ? certData : [];
  const memberships: MembershipRow[] = Array.isArray(membershipData) ? membershipData : [];

  const readiness = deriveReadiness({
    organization: org,
    contacts,
    endpoints,
    certificates: certs,
    memberships,
    approval,
  });
  const canSubmit = readiness.canSubmit && !statusQuery.isLoading;

  function jumpTo(key: ReadinessKey) {
    onClose();
    revealReadinessCard(key);
  }

  async function handleWithdraw() {
    const ok = await confirm({
      title: t('approvalWithdrawConfirmTitle'),
      message: t('approvalWithdrawConfirmMessage'),
      confirmLabel: t('approvalWithdrawBtn'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await withdraw();
      toast.success(t('approvalWithdrawSuccess'));
      onClose();
    } catch (err: unknown) {
      toast.error(
        getErrorCode(err) === 'NOT_PENDING'
          ? t('approvalWithdrawNotPending')
          : t('approvalWithdrawFailed'),
      );
    }
  }

  async function handleSubmit() {
    try {
      await new Promise<void>((resolve, reject) => {
        guard(async () => {
          try {
            await mutateAsync();
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
      toast.success(t('approvalModalSubmitSuccess'));
      onClose();
    } catch (err: unknown) {
      const code = getErrorCode(err);
      const msg = getErrorMessage(err, '');
      if (code === 'APPROVAL_ALREADY_PENDING' || msg.includes('ALREADY_PENDING')) {
        toast.error(t('approvalModalAlreadyPending'));
      } else if (code === 'ORGANIZATION_NOT_FOUND' || msg === 'ORGANIZATION_NOT_FOUND') {
        toast.error(t('approvalModalOrgMissing'));
      } else {
        toast.error(msg || t('approvalModalSubmitFailed'));
      }
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="max-w-2xl"
      title={running ? t('approvalRunningTitle') : t('approvalModalTitle')}
      subtitle={running ? t('approvalRunningSubtitle') : t('approvalModalSubtitle')}
    >
      {running && approval ? (
        <ApprovalRunningRequest approval={approval} />
      ) : (
        <div className="space-y-3">
          <ApprovalStatusBanner approval={approval} />
          {!approval && (
            <p className="rounded-control border border-info-border bg-info-surface p-3 text-xs text-[color:var(--text-primary)]">
              {t('approvalModalPendingNote')}
            </p>
          )}
          {approval?.status === 'APPROVED' && (
            <p className="text-xs text-[color:var(--text-secondary)]">
              {t('approvalModalApprovedHint')}
            </p>
          )}

          {readiness.withdrawal && (
            <Callout tone="warning" icon="logout" title={t('approvalWithdrawalTitle')}>
              <p>{t('approvalWithdrawalNote')}</p>
            </Callout>
          )}

          {/* Readiness checklist — the same rule as the wizard and the right panel */}
          {!readiness.withdrawal && (
            <div
              className={`rounded-control border p-3 ${
                readiness.ready
                  ? 'border-success-border bg-success-surface'
                  : 'border-danger-border bg-danger-surface'
              }`}
            >
              <p
                className={`mb-2 text-xs font-semibold ${
                  readiness.ready ? 'text-success-fg' : 'text-danger-fg'
                }`}
              >
                {readiness.ready ? t('approvalModalAllPassed') : t('approvalModalSomeFailed')}
              </p>
              <ul className="space-y-1">
                {readiness.items.map((item) => {
                  const label = t(READINESS_LABEL[item.key]);
                  if (item.done) {
                    return (
                      <li
                        key={item.key}
                        className="flex items-center gap-2 px-1 py-0.5 text-xs text-[color:var(--text-primary)]"
                      >
                        <Icon
                          name="check_circle"
                          size={14}
                          filled
                          label={t('readinessItemDone')}
                          className="text-success-fg"
                        />
                        <Icon
                          name={READINESS_ICON[item.key]}
                          size={14}
                          className="text-[color:var(--text-muted)]"
                        />
                        <span>{label}</span>
                      </li>
                    );
                  }
                  return (
                    <li key={item.key}>
                      <button
                        type="button"
                        onClick={() => jumpTo(item.key)}
                        className="press-effect flex w-full items-center gap-2 rounded-control px-1 py-0.5 text-left text-xs font-medium text-danger-fg hover:bg-[color:var(--bg-card)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus-ring)]"
                      >
                        <Icon name="cancel" size={14} label={t('readinessItemMissing')} />
                        <Icon name={READINESS_ICON[item.key]} size={14} />
                        <span className="flex-1">{label}</span>
                        <Icon name="arrow_forward" size={14} />
                      </button>
                    </li>
                  );
                })}
              </ul>
              {!readiness.ready && (
                <p className="mt-2 text-xs text-[color:var(--text-secondary)]">
                  {t('approvalModalOpenItemsHint')}
                </p>
              )}
            </div>
          )}

          {org && (
            <Section title={t('organization')}>
              <KV
                k={t('orgCardIdentifier')}
                v={
                  <span className="mono-id text-primary dark:text-brand-400">{org.identifier}</span>
                }
              />
              <KV k={t('orgCardName')} v={org.name} />
              <KV k={t('orgCardEmail')} v={org.email} />
              <KV
                k={t('orgCardCity')}
                v={[org.city, org.country_code].filter(Boolean).join(' · ') || '—'}
              />
              <KV
                k={t('orgModalActiveLabel')}
                v={
                  <StatusPill tone={org.active ? 'success' : 'danger'}>
                    {org.active ? t('approvalModalActive') : t('approvalModalInactive')}
                  </StatusPill>
                }
              />
            </Section>
          )}
          <Section title={t('requestCardSectionContacts', { n: contacts.length })}>
            {contacts.length === 0 && <p className={muted}>{t('approvalModalNoContacts')}</p>}
            {contacts.map((c) => (
              <div key={c.id} className={itemBox}>
                <p className={itemName}>{c.name || '—'}</p>
                <p className={muted}>
                  {parseJsonArray(c.types).join(' · ')} ·{' '}
                  {c.email_validated ? t('contactEmailValidated') : t('contactEmailNotValidated')}
                </p>
              </div>
            ))}
          </Section>
          <Section title={t('requestCardSectionEndpoints', { n: endpoints.length })}>
            {endpoints.length === 0 && <p className={muted}>{t('approvalModalNoEndpoints')}</p>}
            {endpoints.map((ep) => (
              <div key={ep.identifier} className={itemBox}>
                <p className={itemName}>{ep.name || ep.identifier}</p>
                <p className={`${muted} break-all font-mono`}>{ep.address}</p>
                {(ep.ipAddresses ?? []).length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {(ep.ipAddresses ?? []).map((ip) => (
                      <StatusPill key={ip.id ?? ip.ip} tone="neutral" className="font-mono">
                        {ip.ip}
                      </StatusPill>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </Section>
          <Section title={t('requestCardSectionCertificates', { n: certs.length })}>
            {certs.length === 0 && <p className={muted}>{t('approvalModalNoCerts')}</p>}
            {certs.map((c) => {
              const expired = certValidity(c.valid_until).state === 'expired';
              const date = formatDate(c.valid_until, lang) || c.valid_until;
              return (
                <div key={c.id} className={`${itemBox} flex items-start justify-between gap-2`}>
                  <div className="min-w-0">
                    <p className="mono-id break-all text-xs font-medium text-[color:var(--text-primary)]">
                      {c.subject}
                    </p>
                    <p className={muted}>
                      {expired
                        ? t('approvalModalExpired', { date })
                        : t('approvalModalExpires', { date })}
                    </p>
                  </div>
                  {expired && <StatusPill tone="danger">{t('expiryTimelineExpired')}</StatusPill>}
                </div>
              );
            })}
          </Section>
          <Section title={t('requestCardSectionMemberships', { n: memberships.length })}>
            {memberships.length === 0 && <p className={muted}>{t('approvalModalNoMemberships')}</p>}
            {memberships.map((ms) => (
              <div key={ms.id} className={itemBox}>
                <p className={itemName}>{ms.parent_organization}</p>
                <p className={muted}>{parseJsonArray(ms.roles).join(' · ')}</p>
              </div>
            ))}
          </Section>
        </div>
      )}
      <ApprovalHistoryList instanceId={instanceId} />
      <div className="mt-6 flex flex-wrap items-center justify-end gap-2 border-t border-[color:var(--border)] pt-4">
        <Button variant="secondary" onClick={onClose}>
          {running ? t('downloadModalClose') : t('modalCancelBtn')}
        </Button>
        {running ? (
          <Button variant="destructive" onClick={handleWithdraw} disabled={withdrawing}>
            <Icon name="undo" size={16} />
            {withdrawing ? t('modalSavingBtn') : t('approvalWithdrawBtn')}
          </Button>
        ) : (
          <Button onClick={handleSubmit} disabled={!canSubmit || isPending}>
            {isPending ? (
              t('modalSavingBtn')
            ) : readiness.withdrawal ? (
              <>
                <Icon name="logout" size={16} />
                {t('approvalWithdrawalSubmit')}
              </>
            ) : (
              <>
                <Icon name="send" size={16} />
                {t('approvalModalSubmitBtn')}
              </>
            )}
          </Button>
        )}
      </div>
    </Modal>
  );
}
