/**
 * MarketplacePage.tsx – Process Marketplace browse page, App-Store style:
 * header with search ("/" focuses it) and filter chips/pickers, a recommended
 * row, and a responsive grid of process cards with skeleton, empty and error
 * states. Filters live in the URL (so Back from a detail page restores them)
 * and the scroll position is restored on Back. Admins get Add/Edit/Remove.
 * Dependencies: useMarketplace, useMe, i18n.store, marketplace components,
 *               MarketplaceAddModal, MarketplaceEditStatusModal, ui primitives
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigationType, useSearchParams } from 'react-router-dom';
import { useMarketplace } from '../hooks/useMarketplace';
import { useMe } from '../hooks/useMe';
import { useI18n } from '../stores/i18n.store';
import { MarketplaceCard } from '../components/marketplace/MarketplaceCard';
import { MarketplaceFilterBar } from '../components/marketplace/MarketplaceFilterBar';
import { MarketplaceDeleteDialog } from '../components/marketplace/MarketplaceDeleteDialog';
import { MarketplaceAddModal } from '../components/modals/MarketplaceAddModal';
import { MarketplaceEditStatusModal } from '../components/modals/MarketplaceEditStatusModal';
import { Button } from '../components/ui/Button';
import { AdminPageHeader } from '../components/admin/AdminPageHeader';
import { Icon } from '../components/ui/Icon';
import {
  DEFAULT_FILTERS,
  distinctDsfVersions,
  distinctTopics,
  featuredOf,
  filterAndSort,
  type BrowseFilters,
  type SortKey,
  type StatusFilter,
  type TrustFilter,
} from '../components/marketplace/marketplaceUtils';
import type { MarketplaceEntry } from '../api/marketplace.api';

const SEARCH_DEBOUNCE_MS = 200;
const STATUSES: StatusFilter[] = ['ALL', 'APPROVED', 'EXPERIMENTAL', 'DEPRECATED'];
const TRUSTS: TrustFilter[] = ['ALL', 'verified', 'community', 'caution'];
const SORTS: SortKey[] = ['relevance', 'updated', 'popular'];

// Survives the unmount caused by opening a detail page, so Back can restore it.
let savedScrollTop = 0;

function pick<T extends string>(value: string | null, allowed: T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

function CardSkeletons() {
  const { t } = useI18n();
  return (
    <div
      aria-busy="true"
      className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-4"
    >
      <span className="sr-only">{t('loading')}</span>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} aria-hidden="true" className="surface-card flex h-[208px] flex-col gap-3 p-4">
          <div className="flex items-center gap-3">
            <div className="skeleton h-12 w-12 rounded-control" />
            <div className="flex-1 space-y-2">
              <div className="skeleton h-3.5 w-2/3 rounded-full" />
              <div className="skeleton h-3 w-1/3 rounded-full" />
            </div>
          </div>
          <div className="skeleton h-3 w-full rounded-full" />
          <div className="skeleton h-3 w-4/5 rounded-full" />
          <div className="skeleton mt-auto h-6 w-1/2 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function MarketplacePage() {
  const { t } = useI18n();
  const { data: me } = useMe();
  const { data: entries = [], isLoading, isError, refetch } = useMarketplace();
  const navType = useNavigationType();
  const [params, setParams] = useSearchParams();

  const filters: BrowseFilters = {
    q: params.get('q') ?? '',
    status: pick(params.get('status'), STATUSES, 'ALL'),
    topic: params.get('topic') ?? '',
    dsf: params.get('dsf') ?? '',
    trust: pick(params.get('trust'), TRUSTS, 'ALL'),
    sort: pick(params.get('sort'), SORTS, 'relevance'),
  };

  const [searchInput, setSearchInput] = useState(filters.q);
  const [addOpen, setAddOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<MarketplaceEntry | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MarketplaceEntry | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const restoredRef = useRef(false);

  const isAdmin = !!me?.isAdmin;

  const updateFilters = useCallback(
    (patch: Partial<BrowseFilters>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            const def = DEFAULT_FILTERS[k as keyof BrowseFilters];
            if (v === def || v === '') next.delete(k);
            else next.set(k, String(v));
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  // Debounce the search box into the URL.
  useEffect(() => {
    if (searchInput === filters.q) return;
    const id = window.setTimeout(() => updateFilters({ q: searchInput }), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [searchInput, filters.q, updateFilters]);

  // "/" jumps to the search field, like most store-style apps.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      e.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Back from a detail page: put the scroll position back once content exists.
  useLayoutEffect(() => {
    if (restoredRef.current || entries.length === 0 || !scrollRef.current) return;
    restoredRef.current = true;
    if (navType === 'POP') scrollRef.current.scrollTop = savedScrollTop;
    else savedScrollTop = 0;
  }, [entries.length, navType]);

  const topics = useMemo(() => distinctTopics(entries), [entries]);
  const dsfVersions = useMemo(() => distinctDsfVersions(entries), [entries]);
  const filtered = useMemo(
    () => filterAndSort(entries, filters),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, params],
  );
  const isFiltered =
    filters.q !== '' ||
    filters.status !== 'ALL' ||
    filters.topic !== '' ||
    filters.dsf !== '' ||
    filters.trust !== 'ALL';
  const featured = useMemo(
    () => (!isFiltered && entries.length >= 4 ? featuredOf(entries) : []),
    [entries, isFiltered],
  );

  function clearFilters() {
    setSearchInput('');
    setParams({}, { replace: true });
  }

  function renderCard(entry: MarketplaceEntry, i: number) {
    return (
      <div
        key={entry.id}
        className="animate-list-item-in flex min-w-0 flex-col gap-2"
        style={{ '--stagger-index': i } as React.CSSProperties}
      >
        <div className="min-h-0 flex-1">
          <MarketplaceCard entry={entry} />
        </div>
        {isAdmin && (
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => setEditEntry(entry)}>
              {t('marketplaceEdit')}
            </Button>
            <Button size="sm" variant="destructive" onClick={() => setDeleteTarget(entry)}>
              {t('marketplaceDelete')}
            </Button>
          </div>
        )}
      </div>
    );
  }

  const countLabel =
    filtered.length === 1
      ? t('marketplaceResultsOne')
      : t('marketplaceResults', { n: filtered.length });

  return (
    <div
      ref={scrollRef}
      onScroll={(e) => {
        savedScrollTop = e.currentTarget.scrollTop;
      }}
      className="flex-1 overflow-y-auto"
    >
      <AdminPageHeader
        title={t('marketplaceTitle')}
        subtitle={t('marketplaceSubtitle')}
        actions={
          isAdmin ? (
            <Button onClick={() => setAddOpen(true)}>
              <Icon name="add" size={16} />
              {t('marketplaceAdd')}
            </Button>
          ) : undefined
        }
      />
      <div className="flex animate-scale-in flex-col gap-6 px-6 py-6 sm:px-8">
        <MarketplaceFilterBar
          searchValue={searchInput}
          onSearchChange={setSearchInput}
          searchRef={searchRef}
          filters={filters}
          onChange={updateFilters}
          topics={topics}
          dsfVersions={dsfVersions}
        />

        {isLoading && <CardSkeletons />}

        {isError && !isLoading && (
          <div
            role="alert"
            className="surface-card flex flex-col items-center gap-3 px-6 py-10 text-center"
          >
            <Icon name="cloud_off" size={40} className="text-[color:var(--text-muted)]" />
            <p className="m-0 text-sm text-[color:var(--text-secondary)]">
              {t('marketplaceLoadFailed')}
            </p>
            <Button variant="secondary" onClick={() => refetch()}>
              {t('marketplaceRetry')}
            </Button>
          </div>
        )}

        {!isLoading && !isError && (
          <>
            <p
              role="status"
              aria-live="polite"
              className="m-0 text-xs font-medium text-[color:var(--text-secondary)]"
            >
              {countLabel}
            </p>

            {featured.length > 0 && (
              <section aria-labelledby="mp-featured" className="flex flex-col gap-3">
                <h2
                  id="mp-featured"
                  className="m-0 text-base font-semibold text-[color:var(--text-primary)]"
                >
                  {t('marketplaceFeatured')}
                </h2>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-4">
                  {featured.map((e, i) => renderCard(e, i))}
                </div>
              </section>
            )}

            {filtered.length === 0 ? (
              <div className="surface-card flex flex-col items-center gap-3 px-6 py-10 text-center">
                <Icon name="deployed_code" size={40} className="text-[color:var(--text-muted)]" />
                <p className="m-0 text-sm text-[color:var(--text-secondary)]">
                  {entries.length === 0 ? t('marketplaceEmpty') : t('marketplaceNoResults')}
                </p>
                {isFiltered && (
                  <Button variant="secondary" onClick={clearFilters}>
                    {t('marketplaceClearFilters')}
                  </Button>
                )}
              </div>
            ) : (
              <section aria-labelledby="mp-all" className="flex flex-col gap-3">
                {featured.length > 0 && (
                  <h2
                    id="mp-all"
                    className="m-0 text-base font-semibold text-[color:var(--text-primary)]"
                  >
                    {t('marketplaceAllProcesses')}
                  </h2>
                )}
                <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-4">
                  {filtered.map((e, i) => renderCard(e, i))}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      <MarketplaceAddModal open={addOpen} onClose={() => setAddOpen(false)} />

      {editEntry && (
        <MarketplaceEditStatusModal
          open={true}
          onClose={() => setEditEntry(null)}
          entryId={editEntry.id}
          currentStatus={editEntry.status}
          slug={editEntry.slug}
          entry={editEntry}
        />
      )}

      <MarketplaceDeleteDialog entry={deleteTarget} onClose={() => setDeleteTarget(null)} />
    </div>
  );
}
