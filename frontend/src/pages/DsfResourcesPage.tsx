/**
 * DsfResourcesPage.tsx — curated links to the official Data Sharing Framework
 * resources (dsf.dev, hub, GitHub, specifications, MII/NUM). Visible to all
 * authenticated users. Layout: title + one-line intro, a search field and a
 * segmented category filter, a featured "Start here" row while no filter is
 * active, and an animated grid of resource cards with a live result count and
 * an empty state. Every card opens externally in a new tab.
 * Dependencies: react, i18n.store, ui (Icon, Button), lib/dsfResources,
 *               components/resources (ResourceCard, ResourceGrid, CategoryFilter)
 */
import { useCallback, useId, useMemo, useState, type CSSProperties } from 'react';
import { useI18n } from '../stores/i18n.store';
import { Icon } from '../components/ui/Icon';
import { Button } from '../components/ui/Button';
import { ResourceCard } from '../components/resources/ResourceCard';
import { ResourceGrid } from '../components/resources/ResourceGrid';
import { CategoryFilter } from '../components/resources/CategoryFilter';
import {
  CATEGORY_LABEL_KEY,
  DSF_RESOURCES,
  RESOURCE_CATEGORIES,
  filterResources,
  type CategoryFilter as Filter,
  type DsfResource,
} from '../lib/dsfResources';

const FEATURED = DSF_RESOURCES.filter((r) => r.featured);

export function DsfResourcesPage() {
  const { t } = useI18n();
  const [category, setCategory] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const startId = useId();
  const listId = useId();

  const describe = useCallback((r: DsfResource) => t(r.descKey), [t]);
  const matches = useMemo(
    () => filterResources(DSF_RESOURCES, 'all', query, describe),
    [query, describe],
  );
  const counts = useMemo(() => {
    const c = { all: matches.length } as Record<Filter, number>;
    for (const cat of RESOURCE_CATEGORIES)
      c[cat] = matches.filter((r) => r.category === cat).length;
    return c;
  }, [matches]);

  const unfiltered = category === 'all' && query.trim() === '';
  const results = useMemo(
    () => (category === 'all' ? matches : matches.filter((r) => r.category === category)),
    [matches, category],
  );
  const gridItems = useMemo(
    () => (unfiltered ? results.filter((r) => !r.featured) : results),
    [results, unfiltered],
  );

  const clear = () => {
    setQuery('');
    setCategory('all');
  };

  const listHeading =
    category === 'all' ? t('dsfResourcesAllHeading') : t(CATEGORY_LABEL_KEY[category]);
  const countText =
    results.length === 1
      ? t('dsfResourcesResultCountOne')
      : t('dsfResourcesResultCount', { n: results.length });

  return (
    <div className="flex-1 overflow-y-auto font-sans">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-8">
        <header className="flex animate-fade-in flex-col gap-2">
          <h1 className="m-0 text-[28px] font-bold leading-tight tracking-tight text-[color:var(--text-primary)]">
            {t('dsfResourcesTitle')}
          </h1>
          <p className="m-0 max-w-2xl text-[15px] text-[color:var(--text-secondary)]">
            {t('dsfResourcesIntro')}
          </p>
        </header>

        <div className="flex flex-col gap-3">
          <div className="glass flex max-w-xl items-center gap-2 rounded-full px-4 py-1.5">
            <Icon name="search" size={20} className="text-[color:var(--text-muted)]" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('dsfResourcesSearchPlaceholder')}
              aria-label={t('dsfResourcesSearchLabel')}
              aria-controls={listId}
              className="min-h-[36px] min-w-0 flex-1 border-0 bg-transparent text-[15px] text-[color:var(--text-primary)] outline-none placeholder:text-[color:var(--text-muted)]"
            />
          </div>
          <CategoryFilter value={category} onChange={setCategory} counts={counts} />
        </div>

        {unfiltered && (
          <section aria-labelledby={startId} className="flex flex-col gap-3">
            <h2
              id={startId}
              className="m-0 text-[17px] font-semibold text-[color:var(--text-primary)]"
            >
              {t('dsfResourcesStartHere')}
            </h2>
            <ul
              role="list"
              className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-3 p-0"
            >
              {FEATURED.map((r, i) => (
                <li key={r.id} className="min-w-0">
                  <ResourceCard
                    resource={r}
                    featured
                    className="animate-list-item-in"
                    style={{ '--stagger-index': i } as CSSProperties}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby={listId + '-h'} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2
              id={listId + '-h'}
              className="m-0 text-[17px] font-semibold text-[color:var(--text-primary)]"
            >
              {listHeading}
            </h2>
            <p
              aria-live="polite"
              className="m-0 text-[13px] tabular-nums text-[color:var(--text-muted)]"
            >
              {countText}
            </p>
          </div>
          <div id={listId}>
            <ResourceGrid resources={gridItems} />
          </div>
          {results.length === 0 && (
            <div className="glass-thin flex animate-fade-in flex-col items-center gap-2 rounded-[20px] px-6 py-10 text-center">
              <Icon name="search_off" size={32} className="text-[color:var(--text-muted)]" />
              <p className="m-0 text-[15px] font-semibold text-[color:var(--text-primary)]">
                {t('dsfResourcesEmptyTitle')}
              </p>
              <p className="m-0 text-[13px] text-[color:var(--text-secondary)]">
                {t('dsfResourcesEmptyHint')}
              </p>
              <Button variant="secondary" size="sm" onClick={clear} className="mt-2">
                {t('dsfResourcesClearFilters')}
              </Button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
