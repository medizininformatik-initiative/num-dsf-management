/**
 * MarketplaceFilterBar.tsx — the browse controls: a search field ("/"
 * focuses it, handled by the page), status chips (aria-pressed), and select
 * pickers for topic, DSF compatibility, trust level and sort order.
 * Controlled by the page; it holds no state of its own.
 * Dependencies: i18n.store, Icon, marketplaceUtils (types), FormField (none).
 */
import type { Ref } from 'react';
import { useI18n } from '../../stores/i18n.store';
import { Icon } from '../ui/Icon';
import { Select } from '../ui/Select';
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
      <div className="relative flex max-w-xl items-center gap-2 rounded-full border border-[color:var(--border-strong)] bg-[color:var(--bg-input)] px-4 py-1.5 focus-within:border-[color:var(--focus-ring)] focus-within:ring-[3px] focus-within:ring-primary/20 dark:focus-within:ring-brand-400/30">
        <Icon name="search" size={16} className="text-[color:var(--text-muted)]" />
        <input
          ref={searchRef}
          type="search"
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t('marketplaceSearchPlaceholder')}
          aria-label={t('marketplaceSearchPlaceholder')}
          aria-keyshortcuts="/"
          className="min-h-[36px] min-w-0 flex-1 border-0 bg-transparent text-sm text-[color:var(--text-primary)] outline-none placeholder:text-[color:var(--text-muted)]"
        />
        <kbd
          aria-hidden="true"
          title={t('marketplaceSearchKeyHint')}
          className="hidden rounded-small border border-[color:var(--border)] px-1.5 text-2xs text-[color:var(--text-muted)] sm:inline"
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
              className={`press-effect min-h-[36px] rounded-full border px-4 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-ring)] ${
                active
                  ? 'border-transparent bg-[color:var(--accent-solid)] text-white'
                  : 'border-[color:var(--border)] bg-[color:var(--bg-card)] text-[color:var(--text-primary)] hover:border-[color:var(--border-strong)] hover:bg-[color:var(--bg-hover)]'
              }`}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          pill
          aria-label={t('marketplaceFilterTopic')}
          value={filters.topic}
          onChange={(e) => onChange({ topic: e.target.value })}
        >
          <option value="">{t('marketplaceFilterAllTopics')}</option>
          {topics.map((tp) => (
            <option key={tp} value={tp}>
              {tp}
            </option>
          ))}
        </Select>
        <Select
          pill
          aria-label={t('marketplaceFilterDsf')}
          value={filters.dsf}
          onChange={(e) => onChange({ dsf: e.target.value })}
        >
          <option value="">{t('marketplaceFilterAnyDsf')}</option>
          {dsfVersions.map((v) => (
            <option key={v} value={v}>
              {t('marketplaceDsfRunsOn', { v })}
            </option>
          ))}
        </Select>
        <Select
          pill
          aria-label={t('marketplaceFilterTrust')}
          value={filters.trust}
          onChange={(e) => onChange({ trust: e.target.value as TrustFilter })}
        >
          <option value="ALL">{t('marketplaceTrustAll')}</option>
          <option value="verified">{t('marketplaceTrustVerified')}</option>
          <option value="community">{t('marketplaceTrustCommunity')}</option>
          <option value="caution">{t('marketplaceTrustCaution')}</option>
        </Select>
        <label className="ml-auto flex items-center gap-2 text-sm text-[color:var(--text-secondary)]">
          {t('marketplaceSort')}
          <Select
            pill
            value={filters.sort}
            onChange={(e) => onChange({ sort: e.target.value as SortKey })}
          >
            <option value="relevance">{t('marketplaceSortRelevance')}</option>
            <option value="updated">{t('marketplaceSortUpdated')}</option>
            <option value="popular">{t('marketplaceSortPopular')}</option>
          </Select>
        </label>
      </div>
    </div>
  );
}
