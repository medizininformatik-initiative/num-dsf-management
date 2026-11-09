/**
 * SearchBar.tsx – Global search across the active instance's entities. The
 * results drop down on thin glass from the field (origin-aware popover
 * motion, faster exit); choosing one highlights its card and scrolls it into
 * view (scrollIntoViewSafe honours Reduce Motion). Escape is handled on the
 * field itself and marked handled, so it never also closes a surrounding
 * dialog; an outside pointer-down or focus leaving the search closes the
 * results. Ctrl+K belongs to the CommandPalette.
 * Dependencies: useContacts, useEndpoints, useCertificates, useMemberships,
 * useOrganization, canvas.store, i18n.store, lib/dateUtils, lib/motion,
 * PopoverPanel, ui/Icon.
 */
import { useState, useRef, useEffect, useId, type FocusEvent, type KeyboardEvent } from 'react';
import { useContacts } from '../../hooks/useContacts';
import { useEndpoints } from '../../hooks/useEndpoints';
import { useCertificates } from '../../hooks/useCertificates';
import { useMemberships } from '../../hooks/useMemberships';
import { useOrganization } from '../../hooks/useOrganization';
import { useCanvasStore, type EntityId } from '../../stores/canvas.store';
import { useI18n } from '../../stores/i18n.store';
import type { TranslationKey } from '../../i18n/en';
import { formatDate } from '../../lib/dateUtils';
import { scrollIntoViewSafe } from '../../lib/motion';
import { PopoverPanel } from './Popover';
import { Icon } from '../ui/Icon';

type ResultType = 'organization' | 'contact' | 'endpoint' | 'certificate' | 'membership';

interface SearchResult {
  type: ResultType;
  label: string;
  detail: string;
  cardId: EntityId;
}

const TYPE_META: Record<ResultType, { icon: string; color: string; label: TranslationKey }> = {
  organization: {
    icon: 'corporate_fare',
    color: 'var(--primary)',
    label: 'shellEntityOrganization',
  },
  contact: { icon: 'contact_phone', color: '#9b59b6', label: 'shellEntityContact' },
  endpoint: { icon: 'hub', color: '#3ecfb2', label: 'shellEntityEndpoint' },
  certificate: { icon: 'verified_user', color: '#f5a623', label: 'shellEntityCertificate' },
  membership: { icon: 'groups', color: '#4a90d9', label: 'shellEntityMembership' },
};

export function SearchBar() {
  const { t, lang } = useI18n();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const activeInstanceId = useCanvasStore((s) => s.activeInstanceId);
  const highlightEntity = useCanvasStore((s) => s.highlightEntity);

  const { data: org } = useOrganization(activeInstanceId);
  const { data: contacts = [] } = useContacts(activeInstanceId);
  const { data: endpoints = [] } = useEndpoints(activeInstanceId);
  const { data: certs = [] } = useCertificates(activeInstanceId);
  const { data: memberships = [] } = useMemberships(activeInstanceId);

  // Close on a pointer-down outside the search while the results are open.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const q = query.toLowerCase().trim();
  const results: SearchResult[] = [];

  if (q.length >= 2) {
    if (org && (org.name?.toLowerCase().includes(q) || org.identifier?.toLowerCase().includes(q))) {
      results.push({
        type: 'organization',
        label: org.name || org.identifier,
        // Only surface the identifier as the detail line when a name owns the
        // label — without a name the label already shows the identifier.
        detail: org.name ? org.identifier : '',
        cardId: 'organization',
      });
    }
    (contacts as { name?: string; email?: string }[]).forEach((c) => {
      if (c.name?.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q)) {
        results.push({
          type: 'contact',
          label: c.name || c.email || '',
          detail: c.email || '',
          cardId: 'contacts',
        });
      }
    });
    (endpoints as { identifier?: string; name?: string; address?: string }[]).forEach((ep) => {
      if (
        ep.identifier?.toLowerCase().includes(q) ||
        ep.name?.toLowerCase().includes(q) ||
        ep.address?.toLowerCase().includes(q)
      ) {
        results.push({
          type: 'endpoint',
          label: ep.name || ep.identifier || '',
          detail: ep.address || '',
          cardId: 'endpoints',
        });
      }
    });
    (certs as { subject?: string; thumbprint?: string; valid_until?: string }[]).forEach((cert) => {
      if (cert.subject?.toLowerCase().includes(q) || cert.thumbprint?.toLowerCase().includes(q)) {
        results.push({
          type: 'certificate',
          label: cert.subject || '',
          detail: t('searchCertValidUntil', {
            date: cert.valid_until ? formatDate(cert.valid_until, lang) : '',
          }),
          cardId: 'certificates',
        });
      }
    });
    (memberships as { parent_organization?: string }[]).forEach((ms) => {
      if (ms.parent_organization?.toLowerCase().includes(q)) {
        results.push({
          type: 'membership',
          label: ms.parent_organization || '',
          detail: '',
          cardId: 'memberships',
        });
      }
    });
  }

  function handleSelect(r: SearchResult) {
    highlightEntity(r.cardId);
    scrollIntoViewSafe(document.getElementById(`card-${r.cardId}`), { block: 'center' });
    setOpen(false);
    setQuery('');
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || (!open && !query)) return;
    // Handled here: a dialog around the search must not close as well.
    e.preventDefault();
    setOpen(false);
    setQuery('');
    inputRef.current?.focus();
  }

  function handleBlur(e: FocusEvent) {
    const next = e.relatedTarget;
    if (next instanceof Node && !rootRef.current?.contains(next)) setOpen(false);
  }

  const showResults = open && q.length >= 2;

  return (
    <div ref={rootRef} className="relative" onKeyDown={handleKeyDown} onBlur={handleBlur}>
      <div className="flex w-60 items-center gap-1.5 rounded-control border border-[color:var(--border)] bg-[color:var(--bg-hover)] px-3 py-1.5 focus-within:border-[color:var(--focus-ring)]">
        <Icon name="search" size={16} className="shrink-0 text-[color:var(--text-muted)]" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={t('searchEntities')}
          aria-label={t('searchEntities')}
          aria-controls={showResults && results.length > 0 ? listId : undefined}
          className="w-full min-w-0 bg-transparent text-xs text-[color:var(--text-primary)] outline-none placeholder:text-[color:var(--text-muted)]"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setOpen(false);
              inputRef.current?.focus();
            }}
            aria-label={t('searchClearAria')}
            className="press-effect flex shrink-0 rounded-small text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-ring)]"
          >
            <Icon name="close" size={14} />
          </button>
        )}
      </div>

      <PopoverPanel
        open={showResults}
        origin="top"
        tabIndex={undefined}
        className="left-0 right-0 top-full mt-1 max-h-[300px] overflow-y-auto"
      >
        {results.length > 0 ? (
          <div id={listId} role="listbox" aria-label={t('searchResultsAria')}>
            {results.slice(0, 10).map((r, i) => {
              const meta = TYPE_META[r.type];
              const typeLabel = t(meta.label);
              return (
                <button
                  key={`${r.type}-${i}`}
                  type="button"
                  role="option"
                  aria-label={`${typeLabel}: ${r.label}`}
                  onClick={() => handleSelect(r)}
                  className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors duration-micro ease-standard first:rounded-t-card last:rounded-b-card hover:bg-slate-900/[0.06] focus-visible:bg-slate-900/[0.06] focus-visible:outline-none dark:hover:bg-white/10 dark:focus-visible:bg-white/10"
                >
                  <Icon
                    name={meta.icon}
                    size={18}
                    className="shrink-0"
                    style={{ color: meta.color }}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-[color:var(--text-primary)]">
                      {r.label}
                    </p>
                    {r.detail && (
                      <p className="truncate text-[11px] text-[color:var(--text-muted)]">
                        {r.detail}
                      </p>
                    )}
                  </div>
                  <span className="ml-auto shrink-0 whitespace-nowrap rounded-small bg-[color:var(--bg-page)] px-1.5 py-0.5 text-[11px] text-[color:var(--text-muted)]">
                    {typeLabel}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="px-3.5 py-4 text-center text-xs text-[color:var(--text-muted)]">
            {t('searchNoResults', { query })}
          </p>
        )}
      </PopoverPanel>
    </div>
  );
}
