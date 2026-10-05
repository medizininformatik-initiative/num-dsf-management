/**
 * AdminCaBlacklistPage.tsx – /app/admin/ca-blacklist: the certificate
 * authorities admin page with two tabs, the CA whitelist (the CAs DSF 2.1.1
 * accepts, with a search and kind filter in the sticky header) and the CA
 * blacklist (CAs refused on certificate upload). The active tab lives in the
 * URL (?tab=blacklist) so it can be linked and survives a reload; both panels
 * stay mounted so a half-filled form survives a tab switch.
 * Dependencies: useAdmin (useCaWhitelist, useCaBlacklist), AdminPageHeader,
 * CaWhitelistPanel, CaBlacklistPanel, caDn, Icon, fieldClasses, i18n store,
 * react-router.
 */
import { useRef, useState, type KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useCaBlacklist, useCaWhitelist } from '../hooks/useAdmin';
import { useI18n } from '../stores/i18n.store';
import { AdminPageHeader } from '../components/admin/AdminPageHeader';
import { CaWhitelistPanel, type CaKindFilter } from '../components/admin/CaWhitelistPanel';
import { CaBlacklistPanel } from '../components/admin/CaBlacklistPanel';
import { FIELD_CLASS } from '../components/admin/fieldClasses';
import { commonName } from '../components/admin/caDn';
import { Icon } from '../components/ui/Icon';

type CaTab = 'whitelist' | 'blacklist';
const TABS: CaTab[] = ['whitelist', 'blacklist'];
const KIND_FILTERS: CaKindFilter[] = ['ALL', 'CLIENT', 'SERVER'];

export function AdminCaBlacklistPage() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const tab: CaTab = params.get('tab') === 'blacklist' ? 'blacklist' : 'whitelist';
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<CaKindFilter>('ALL');
  const whitelist = useCaWhitelist();
  const blacklist = useCaBlacklist();

  function selectTab(next: CaTab) {
    setParams(next === 'whitelist' ? {} : { tab: next }, { replace: true });
  }

  function showInWhitelist(subjectDn: string) {
    setKind('ALL');
    setQuery(commonName(subjectDn));
    selectTab('whitelist');
  }

  const counts: Record<CaTab, number | undefined> = {
    whitelist: whitelist.data?.whitelist.length,
    blacklist: blacklist.data?.blacklist.length,
  };

  return (
    <div className="flex-1 overflow-y-auto" data-testid="admin-ca-blacklist">
      <AdminPageHeader
        icon="verified_user"
        title={t('caListsTitle')}
        subtitle={t('caListsSubtitle')}
        toolbar={
          <div className="flex flex-wrap items-center gap-3">
            <CaTabs tab={tab} counts={counts} onSelect={selectTab} />
            {tab === 'whitelist' && (
              <WhitelistFilters
                query={query}
                onQueryChange={setQuery}
                kind={kind}
                onKindChange={setKind}
              />
            )}
          </div>
        }
      />
      <div className="px-6 py-6 sm:px-8">
        <div
          role="tabpanel"
          id="ca-panel-whitelist"
          aria-labelledby="ca-tab-whitelist"
          hidden={tab !== 'whitelist'}
          className="animate-fade-in"
        >
          <CaWhitelistPanel
            data={whitelist.data}
            isLoading={whitelist.isLoading}
            isError={whitelist.isError}
            knownCas={blacklist.data?.knownCas ?? []}
            query={query}
            kind={kind}
          />
        </div>
        <div
          role="tabpanel"
          id="ca-panel-blacklist"
          aria-labelledby="ca-tab-blacklist"
          hidden={tab !== 'blacklist'}
          className="animate-fade-in"
        >
          <CaBlacklistPanel
            blacklist={blacklist.data?.blacklist ?? []}
            knownCas={blacklist.data?.knownCas ?? []}
            isLoading={blacklist.isLoading}
            isError={blacklist.isError}
            onShowInWhitelist={showInWhitelist}
          />
        </div>
      </div>
    </div>
  );
}

function CaTabs({
  tab,
  counts,
  onSelect,
}: {
  tab: CaTab;
  counts: Record<CaTab, number | undefined>;
  onSelect: (tab: CaTab) => void;
}) {
  const { t } = useI18n();
  const refs = useRef<Partial<Record<CaTab, HTMLButtonElement | null>>>({});

  // Roving focus per the ARIA tabs pattern: arrows, Home and End move and select.
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const i = TABS.indexOf(tab);
    const next =
      e.key === 'ArrowRight'
        ? TABS[(i + 1) % TABS.length]
        : e.key === 'ArrowLeft'
          ? TABS[(i - 1 + TABS.length) % TABS.length]
          : e.key === 'Home'
            ? TABS[0]
            : e.key === 'End'
              ? TABS[TABS.length - 1]
              : null;
    if (!next) return;
    e.preventDefault();
    onSelect(next);
    refs.current[next]?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label={t('caTabsAria')}
      onKeyDown={onKeyDown}
      className="inline-flex rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-hover)] p-1"
    >
      {TABS.map((id) => {
        const selected = id === tab;
        return (
          <button
            key={id}
            ref={(el) => {
              refs.current[id] = el;
            }}
            type="button"
            role="tab"
            id={`ca-tab-${id}`}
            aria-selected={selected}
            aria-controls={`ca-panel-${id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(id)}
            className={`press-effect inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--focus-ring)] ${
              selected
                ? 'bg-[color:var(--bg-card)] text-[color:var(--text-primary)] shadow-card-elevated'
                : 'text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]'
            }`}
          >
            <Icon name={id === 'whitelist' ? 'verified' : 'block'} size={18} />
            {id === 'whitelist' ? t('caWhitelistTitle') : t('caBlacklistTitle')}
            {counts[id] !== undefined && (
              <span className="min-w-[1.25rem] rounded-full bg-[color:var(--bg-page)] px-1.5 text-center text-[11px] font-semibold tabular-nums text-[color:var(--text-secondary)]">
                {counts[id]}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function WhitelistFilters({
  query,
  onQueryChange,
  kind,
  onKindChange,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  kind: CaKindFilter;
  onKindChange: (kind: CaKindFilter) => void;
}) {
  const { t } = useI18n();
  const label: Record<CaKindFilter, string> = {
    ALL: t('caKindAll'),
    CLIENT: t('caKindClient'),
    SERVER: t('caKindServer'),
  };
  return (
    <>
      <div className="relative min-w-[12rem] flex-1">
        <Icon
          name="search"
          size={18}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)]"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          aria-label={t('caSearchLabel')}
          placeholder={t('caSearchPlaceholder')}
          className={`${FIELD_CLASS} pl-9`}
          data-testid="ca-whitelist-search"
        />
      </div>
      <div
        role="group"
        aria-label={t('caKindFilterAria')}
        className="inline-flex rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-hover)] p-1"
      >
        {KIND_FILTERS.map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={kind === k}
            onClick={() => onKindChange(k)}
            className={`press-effect rounded-lg px-3 py-1.5 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--focus-ring)] ${
              kind === k
                ? 'bg-[color:var(--bg-card)] text-[color:var(--text-primary)] shadow-card-elevated'
                : 'text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]'
            }`}
          >
            {label[k]}
          </button>
        ))}
      </div>
    </>
  );
}
