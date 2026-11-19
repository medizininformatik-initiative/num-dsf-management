/**
 * useNewRequestNotifier.ts – Tells admins in the app when a new approval
 * request arrives. Mounted once in the app shell. Polls the pending list
 * through usePendingApprovals (shared cache with the admin page and the
 * sidebar badge; no polling in background tabs), remembers the ids already
 * seen per admin in localStorage and shows a toast plus a notification-center
 * entry for ids it has not seen. The first load after login only records the
 * current ids. Storage failures fall back to an in-memory set.
 * Dependencies: useMe, useAdmin, parseSnapshot, i18n.store, notification.store,
 * sonner, react-router-dom.
 */
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useMe } from './useMe';
import { usePendingApprovals } from './useAdmin';
import type { PendingRequest } from '../api/admin.api';
import { parseSnapshot } from '../components/admin/parseSnapshot';
import { useI18n } from '../stores/i18n.store';
import { useNotificationStore } from '../stores/notification.store';

const STORAGE_PREFIX = 'dsf.seenPendingRequests:';

function readSeen(key: string): Set<string> | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((v): v is string => typeof v === 'string'))
      : null;
  } catch {
    return null;
  }
}

function writeSeen(key: string, ids: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...ids]));
  } catch {
    // Storage unavailable: the in-memory set still prevents repeats.
  }
}

/** Friendliest label of a request: organisation name, else identifier. */
function requestLabel(request: PendingRequest): string {
  const org = parseSnapshot(request.snapshot_json).organization;
  const name = typeof org?.name === 'string' ? org.name.trim() : '';
  const identifier = typeof org?.identifier === 'string' ? org.identifier.trim() : '';
  return name || identifier || request.id;
}

export function useNewRequestNotifier(): void {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { data: me } = useMe();
  const isAdmin = !!me?.isAdmin;
  const { data: pending } = usePendingApprovals(isAdmin);
  // Per admin key: the ids seen so far in this session (null = first load).
  const seenRef = useRef<{ key: string; ids: Set<string> | null } | null>(null);

  useEffect(() => {
    if (!isAdmin || !me?.email || !pending) return;
    const key = STORAGE_PREFIX + me.email;
    if (seenRef.current?.key !== key) seenRef.current = { key, ids: readSeen(key) };
    const state = seenRef.current;
    const currentIds = new Set(pending.map((r) => r.id));
    const known = state.ids;
    state.ids = currentIds;
    writeSeen(key, currentIds);
    if (known === null) return; // first load: record without notifying
    const fresh = pending.filter((r) => !known.has(r.id));
    if (fresh.length === 0) return;
    const message =
      fresh.length === 1
        ? t('newRequestNotice', { label: requestLabel(fresh[0]) })
        : t('newRequestsNotice', { n: fresh.length });
    useNotificationStore.getState().addNotification(message, 'info');
    toast.info(message, {
      action: { label: t('newRequestNoticeOpen'), onClick: () => navigate('/app/admin') },
    });
  }, [isAdmin, me?.email, pending, t, navigate]);
}
