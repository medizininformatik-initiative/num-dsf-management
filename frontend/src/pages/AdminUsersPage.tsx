/**
 * AdminUsersPage.tsx – /app/admin/users
 * Whitelist + admin-grant management. Every action is confirmed in a dialog
 * that says what happens and, in OTP sessions, takes the TOTP step-up code
 * (StepUpConfirmDialog on the foundation Modal: Escape, focus trap and
 * restore, animation). A failed attempt keeps the dialog open and clears the
 * spent code.
 * Dependencies: adminUsersApi, adminPromotionsApi, useI18n, useMe,
 * useToastMutation, AdminPageHeader, StepUpConfirmDialog, Button, StatusPill,
 * Icon, Skeleton, fieldClasses, tanstack-query, sonner
 */
import { useId, useState, type CSSProperties, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { adminUsersApi, adminPromotionsApi, type WhitelistEntry } from '../api/admin.api';
import { useI18n } from '../stores/i18n.store';
import type { TranslationKey } from '../i18n/en';
import { useMe } from '../hooks/useMe';
import { useToastMutation } from '../hooks/useToastMutation';
import { AdminPageHeader } from '../components/admin/AdminPageHeader';
import { StepUpConfirmDialog } from '../components/admin/StepUpConfirmDialog';
import { FIELD_CLASS, LABEL_CLASS } from '../components/admin/fieldClasses';
import { Button } from '../components/ui/Button';
import { StatusPill } from '../components/ui/StatusPill';
import { Icon } from '../components/ui/Icon';
import { Skeleton } from '../components/ui/Skeleton';

import { adminCertificatesApi, type AdminCertificate } from '../api/adminCertificates.api';
import {
  AdminUserCertificatesDialog,
  ALL_ADMIN_CERTS_KEY,
} from '../components/admin/AdminUserCertificatesDialog';
import { PendingCertRequestsCard } from '../components/admin/PendingCertRequestsCard';
import { certValidity, CERT_STATE_TONE } from '../lib/certStatus';
import { formatDate } from '../lib/dateUtils';

/** "2 certificates, next expiry 12.03.2027" with a tone pill for the nearest expiry. */
function CertSummary({ certs }: { certs: AdminCertificate[] }) {
  const { t, lang } = useI18n();
  if (certs.length === 0) return <span className="text-warning-fg">{t('adminUsersNoCerts')}</span>;
  const dated = certs.filter((c) => c.validUntil);
  const next = dated.length
    ? dated.reduce((a, b) => (new Date(a.validUntil!) <= new Date(b.validUntil!) ? a : b))
    : null;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span>{t('adminUsersCertCount', { n: certs.length })}</span>
      {next?.validUntil && (
        <StatusPill tone={CERT_STATE_TONE[certValidity(next.validUntil).state]}>
          {formatDate(next.validUntil, lang)}
        </StatusPill>
      )}
    </span>
  );
}

type ActionKind = 'add' | 'lock' | 'unlock' | 'demote' | 'remove' | 'promote';

interface PendingAction {
  kind: ActionKind;
  email: string;
}

const TITLE_KEY: Record<ActionKind, TranslationKey> = {
  add: 'adminUsersConfirm_add',
  lock: 'adminUsersConfirm_lock',
  unlock: 'adminUsersConfirm_unlock',
  demote: 'adminUsersConfirm_demote',
  remove: 'adminUsersConfirm_remove',
  promote: 'adminUsersConfirm_promote',
};

const BODY_KEY: Record<ActionKind, TranslationKey> = {
  add: 'adminUsersConfirmBody_add',
  lock: 'adminUsersConfirmBody_lock',
  unlock: 'adminUsersConfirmBody_unlock',
  demote: 'adminUsersConfirmBody_demote',
  remove: 'adminUsersConfirmBody_remove',
  promote: 'adminUsersConfirmBody_promote',
};

const CONFIRM_KEY: Record<ActionKind, TranslationKey> = {
  add: 'adminUsersAdd',
  lock: 'adminUsersLock',
  unlock: 'adminUsersUnlock',
  demote: 'adminUsersDemote',
  remove: 'adminUsersRemove',
  promote: 'adminUsersPromote',
};

const DESTRUCTIVE: ReadonlySet<ActionKind> = new Set(['lock', 'demote', 'remove']);

export function AdminUsersPage() {
  const { t } = useI18n();
  const { data: me } = useMe();
  const qc = useQueryClient();
  const emailId = useId();
  const reasonId = useId();

  const { data: users, isLoading } = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: adminUsersApi.list,
    staleTime: 15_000,
  });

  const { data: adminCerts } = useQuery({
    queryKey: ALL_ADMIN_CERTS_KEY,
    queryFn: adminCertificatesApi.all,
    enabled: !me || me.isAdmin,
    staleTime: 15_000,
  });
  const [certsFor, setCertsFor] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [lockReason, setLockReason] = useState('');

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'users'] });
  const errorFallback = t('genericActionFailed');

  const mutAdd = useToastMutation({
    mutationFn: (vars: { email: string; totpCode?: string }) =>
      adminUsersApi.add(vars.email, vars.totpCode),
    successMessage: t('adminUsersAddedToast'),
    onSuccess: invalidate,
    errorFallback,
  });

  const mutLock = useToastMutation({
    mutationFn: (vars: { email: string; reason: string; totpCode?: string }) =>
      adminUsersApi.lock(vars.email, vars.reason, vars.totpCode),
    successMessage: t('adminUsersLockedToast'),
    onSuccess: invalidate,
    errorFallback,
  });

  const mutUnlock = useToastMutation({
    mutationFn: (vars: { email: string; totpCode?: string }) =>
      adminUsersApi.unlock(vars.email, vars.totpCode),
    successMessage: t('adminUsersUnlockedToast'),
    onSuccess: invalidate,
    errorFallback,
  });

  const mutDemote = useToastMutation({
    mutationFn: (vars: { email: string; totpCode?: string }) =>
      adminUsersApi.demote(vars.email, vars.totpCode),
    successMessage: t('adminUsersDemotedToast'),
    onSuccess: invalidate,
    errorFallback,
  });

  const mutRemove = useToastMutation({
    mutationFn: (vars: { email: string; totpCode?: string }) =>
      adminUsersApi.remove(vars.email, vars.totpCode),
    successMessage: t('adminUsersRemovedToast'),
    onSuccess: invalidate,
    errorFallback,
  });

  const mutPromote = useToastMutation({
    mutationFn: (vars: { email: string; totpCode?: string }) =>
      adminPromotionsApi.create(vars.email, vars.totpCode),
    successMessage: t('adminUsersPromoteRequestedToast'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'promotions'] }),
    errorFallback,
  });

  if (me && !me.isAdmin) return <Navigate to="/app" replace />;

  // The confirm button fires a single-use TOTP-guarded mutation; gate it on the
  // matching mutation's pending state so a double-click can't consume the code
  // twice (the second call 401s on the already-spent code).
  const confirmPending =
    (pending?.kind === 'add' && mutAdd.isPending) ||
    (pending?.kind === 'lock' && mutLock.isPending) ||
    (pending?.kind === 'unlock' && mutUnlock.isPending) ||
    (pending?.kind === 'demote' && mutDemote.isPending) ||
    (pending?.kind === 'remove' && mutRemove.isPending) ||
    (pending?.kind === 'promote' && mutPromote.isPending);

  function close() {
    setPending(null);
    setTotpCode('');
    setLockReason('');
  }

  function execute(code: string | undefined) {
    if (!pending) return;
    const totpField = code !== undefined ? { totpCode: code } : {};
    // Success closes the dialog; a failure keeps it open for a fresh code.
    const settle = { onSuccess: close, onError: () => setTotpCode('') };
    const { kind, email } = pending;
    if (kind === 'add') {
      mutAdd.mutate(
        { email, ...totpField },
        {
          ...settle,
          onSuccess: () => {
            close();
            setNewEmail('');
          },
        },
      );
    } else if (kind === 'lock') {
      mutLock.mutate({ email, reason: lockReason, ...totpField }, settle);
    } else if (kind === 'unlock') {
      mutUnlock.mutate({ email, ...totpField }, settle);
    } else if (kind === 'demote') {
      mutDemote.mutate({ email, ...totpField }, settle);
    } else if (kind === 'remove') {
      mutRemove.mutate({ email, ...totpField }, settle);
    } else if (kind === 'promote') {
      mutPromote.mutate({ email, ...totpField }, settle);
    }
  }

  function requestAdd(e: FormEvent) {
    e.preventDefault();
    const email = newEmail.trim();
    if (!email) {
      toast.error(t('adminUsersAddPlaceholder'));
      return;
    }
    setTotpCode('');
    setPending({ kind: 'add', email });
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <AdminPageHeader title={t('adminUsersTitle')} subtitle={t('adminUsersSubtitle')} />

      <div className="space-y-5 px-6 py-6 sm:px-8">
        {/* Add row */}
        <form
          onSubmit={requestAdd}
          className="flex flex-wrap items-end gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-card)] p-4"
        >
          <div className="min-w-[14rem] flex-1">
            <label htmlFor={emailId} className={LABEL_CLASS}>
              {t('adminUsersAddLabel')}
            </label>
            <input
              id={emailId}
              type="email"
              autoComplete="off"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder={t('adminUsersAddPlaceholder')}
              className={FIELD_CLASS}
            />
          </div>
          <Button type="submit">
            <Icon name="person_add" size={18} />
            {t('adminUsersAdd')}
          </Button>
        </form>

        <PendingCertRequestsCard meEmail={me?.email ?? null} />

        {isLoading && (
          <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-card)] p-5">
            <Skeleton lines={4} />
          </div>
        )}

        {users && (
          <div className="overflow-x-auto rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-card)]">
            <table className="w-full border-collapse text-left text-[13px]">
              <thead className="bg-[color:var(--bg-hover)]">
                <tr className="text-[11px] font-bold uppercase tracking-wide text-[color:var(--text-secondary)]">
                  <th className="px-4 py-2.5">{t('adminUsersColEmail')}</th>
                  <th className="px-4 py-2.5">{t('adminUsersColRole')}</th>
                  <th className="px-4 py-2.5">{t('adminUsersColStatus')}</th>
                  <th className="px-4 py-2.5">{t('adminUsersColCertificates')}</th>
                  <th className="px-4 py-2.5">{t('adminUsersColAddedBy')}</th>
                  <th className="px-4 py-2.5">{t('adminUsersColActions')}</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u, i) => (
                  <Row
                    key={u.email}
                    u={u}
                    index={i}
                    meEmail={me?.email ?? null}
                    certs={(adminCerts ?? []).filter(
                      (c) => c.email.toLowerCase() === u.email.toLowerCase(),
                    )}
                    onCertificates={() => setCertsFor(u.email)}
                    onAction={(kind) => {
                      setTotpCode('');
                      setPending({ kind, email: u.email });
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AdminUserCertificatesDialog email={certsFor} onClose={() => setCertsFor(null)} />

      <StepUpConfirmDialog
        open={pending !== null}
        title={pending ? t(TITLE_KEY[pending.kind]) : ''}
        subtitle={pending?.email}
        message={pending ? t(BODY_KEY[pending.kind]) : undefined}
        confirmLabel={pending ? t(CONFIRM_KEY[pending.kind]) : t('confirm')}
        destructive={pending ? DESTRUCTIVE.has(pending.kind) : false}
        pending={confirmPending}
        isDirty={pending?.kind === 'lock' && lockReason.trim() !== ''}
        totpCode={totpCode}
        onTotpCodeChange={setTotpCode}
        onConfirm={execute}
        onCancel={close}
      >
        {pending?.kind === 'lock' && (
          <div>
            <label htmlFor={reasonId} className={LABEL_CLASS}>
              {t('adminUsersLockReasonLabel')}
            </label>
            <textarea
              id={reasonId}
              value={lockReason}
              onChange={(e) => setLockReason(e.target.value)}
              placeholder={t('adminUsersLockReasonPlaceholder')}
              rows={3}
              className={`${FIELD_CLASS} resize-y`}
            />
          </div>
        )}
      </StepUpConfirmDialog>
    </div>
  );
}

function Row({
  u,
  index,
  meEmail,
  certs,
  onCertificates,
  onAction,
}: {
  u: WhitelistEntry;
  index: number;
  meEmail: string | null;
  certs: AdminCertificate[];
  onCertificates: () => void;
  onAction: (k: ActionKind) => void;
}) {
  const { t } = useI18n();
  const isMe = meEmail != null && u.email.toLowerCase() === meEmail.toLowerCase();
  const isLocked = u.locked_at != null;

  return (
    <tr
      style={{ '--stagger-index': index } as CSSProperties}
      className="animate-list-item-in border-t border-[color:var(--border)] align-middle"
    >
      <td className="px-4 py-3 text-[color:var(--text-primary)]">
        <span className="break-all">{u.email}</span>
        {isMe && (
          <span className="ml-1.5 text-[11px] text-[color:var(--text-muted)]">
            ({t('adminUsersYou')})
          </span>
        )}
      </td>
      <td className="px-4 py-3">
        {u.is_admin ? (
          <StatusPill tone="info" icon="shield_person">
            {t('adminUsersRoleAdmin')}
          </StatusPill>
        ) : (
          <span className="text-xs text-[color:var(--text-muted)]">{t('adminUsersRoleUser')}</span>
        )}
      </td>
      <td className="px-4 py-3">
        {isLocked ? (
          <StatusPill tone="danger" icon="lock">
            {t('adminUsersStatusLocked')}
          </StatusPill>
        ) : (
          <StatusPill tone="success" icon="check_circle">
            {t('adminUsersStatusActive')}
          </StatusPill>
        )}
      </td>
      <td className="px-4 py-3 text-xs text-[color:var(--text-secondary)]">
        {u.is_admin ? <CertSummary certs={certs} /> : '—'}
      </td>
      <td className="px-4 py-3 font-mono text-xs text-[color:var(--text-muted)]">
        {u.created_by ?? '—'}
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1.5">
          {!isLocked && !isMe && (
            <Button size="sm" variant="secondary" onClick={() => onAction('lock')}>
              {t('adminUsersLock')}
            </Button>
          )}
          {isLocked && (
            <Button size="sm" variant="secondary" onClick={() => onAction('unlock')}>
              {t('adminUsersUnlock')}
            </Button>
          )}
          {u.is_admin && !isMe && (
            <Button size="sm" variant="secondary" onClick={() => onAction('demote')}>
              {t('adminUsersDemote')}
            </Button>
          )}
          {u.is_admin && !isMe && (
            <Button size="sm" variant="secondary" onClick={onCertificates}>
              {t('adminUsersCertificates')}
            </Button>
          )}
          {!u.is_admin && !isLocked && !isMe && (
            <Button size="sm" variant="secondary" onClick={() => onAction('promote')}>
              {t('adminUsersPromote')}
            </Button>
          )}
          {!isMe && (
            <Button
              size="sm"
              variant="secondary"
              className="text-danger-fg"
              onClick={() => onAction('remove')}
            >
              {t('adminUsersRemove')}
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}
