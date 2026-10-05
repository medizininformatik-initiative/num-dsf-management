/**
 * MarketplaceFilterBar.tsx — the browse controls: a glass search field ("/"
 * focuses it, handled by the page), status chips (aria-pressed), and select
 * pickers for topic, DSF compatibility, trust level and sort order.
 * Controlled by the page; it holds no state of its own.
 * Dependencies: i18n.store, Icon, marketplaceUtils (types), FormField (none).
 */
import type { Ref } from 'react';
import { useI18n } from '../../stores/i18n.store';
import { Icon } from '../ui/Icon';
import type { BrowseFilters, SortKey, StatusFilter, TrustFilter } from './marketplaceUtils';

interface Props {
  searchValue: string;
  onSearchChange: (v: string) => void;
  searchRef: Ref<HTMLInputElement>;
  filters: BrowseFilters;
  onChange: (patch: Partial<BrowseFilters>) => void;
  topics: string[];
  dsfVersions: string[];
}

const SELECT_CLASS =
  'glass-thin press-effect min-h-[40px] rounded-full px-3.5 py-2 text-[13px] text-[color:var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--primary)]';

export function MarketplaceFilterBar({
  searchValue,
  onSearchChange,
  searchRef,
  filters,
  onChange,
  topics,
  dsfVersions,
}: Props) {
  const { t } = useI18n();

  const statusChips: { key: StatusFilter; label: string }[] = [
    { key: 'ALL', label: t('marketplaceFilterAll') },
    { key: 'APPROVED', label: t('marketplaceStatusApproved') },
    { key: 'EXPERIMENTAL', label: t('marketplaceStatusExperimental') },
    { key: 'DEPRECATED', label: t('marketplaceStatusDeprecated') },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="glass relative flex max-w-xl items-center gap-2 rounded-full px-4 py-1.5">
        <Icon name="search" size={20} className="text-[color:var(--text-muted)]" />
        <input
          ref={searchRef}
          type="search"
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t('marketplaceSearchPlaceholder')}
          aria-label={t('marketplaceSearchPlaceholder')}
          aria-keyshortcuts="/"
          className="min-h-[36px] min-w-0 flex-1 border-0 bg-transparent text-[15px] text-[color:var(--text-primary)] outline-none placeholder:text-[color:var(--text-muted)]"
        />
        <kbd
          aria-hidden="true"
          title={t('marketplaceSearchKeyHint')}
          className="hidden rounded-md border border-[color:var(--border)] px-1.5 text-[11px] text-[color:var(--text-muted)] sm:inline"
        >
          /
        </kbd>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {statusChips.map((c) => {
          const active = filters.status === c.key;
          return (
            <button
              key={c.key}
              type="button"
              aria-pressed={active}
              onClick={() => onChange({ status: c.key })}
              className={`press-effect min-h-[36px] rounded-full border px-4 text-[13px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--primary)] ${
                active
                  ? 'border-transparent bg-[color:var(--accent-solid)] text-white'
                  : 'glass-thin text-[color:var(--text-primary)]'
              }`}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={t('marketplaceFilterTopic')}
          value={filters.topic}
          onChange={(e) => onChange({ topic: e.target.value })}
          className={SELECT_CLASS}
        >
          <option value="">{t('marketplaceFilterAllTopics')}</option>
          {topics.map((tp) => (
            <option key={tp} value={tp}>
              {tp}
            </option>
          ))}
        </select>
        <select
          aria-label={t('marketplaceFilterDsf')}
          value={filters.dsf}
          onChange={(e) => onChange({ dsf: e.target.value })}
          className={SELECT_CLASS}
        >
          <option value="">{t('marketplaceFilterAnyDsf')}</option>
          {dsfVersions.map((v) => (
            <option key={v} value={v}>
              {t('marketplaceDsfRunsOn', { v })}
            </option>
          ))}
        </select>
        <select
          aria-label={t('marketplaceFilterTrust')}
          value={filters.trust}
          onChange={(e) => onChange({ trust: e.target.value as TrustFilter })}
          className={SELECT_CLASS}
        >
          <option value="ALL">{t('marketplaceTrustAll')}</option>
          <option value="verified">{t('marketplaceTrustVerified')}</option>
          <option value="community">{t('marketplaceTrustCommunity')}</option>
          <option value="caution">{t('marketplaceTrustCaution')}</option>
        </select>
        <label className="ml-auto flex items-center gap-2 text-[13px] text-[color:var(--text-secondary)]">
          {t('marketplaceSort')}
          <select
            value={filters.sort}
            onChange={(e) => onChange({ sort: e.target.value as SortKey })}
            className={SELECT_CLASS}
          >
            <option value="relevance">{t('marketplaceSortRelevance')}</option>
            <option value="updated">{t('marketplaceSortUpdated')}</option>
            <option value="popular">{t('marketplaceSortPopular')}</option>
          </select>
        </label>
      </div>
    </div>
  );
}
