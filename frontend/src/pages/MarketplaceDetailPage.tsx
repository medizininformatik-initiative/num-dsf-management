/**
 * MarketplaceDetailPage.tsx – per-process detail at /app/marketplace/:slug.
 * A sticky glass bar (Back, and name + GitHub action once scrolled), a hero
 * with tile, name, publisher, trust and the primary actions, an advisory
 * banner, and a segmented control over Overview / Releases / Compatibility /
 * Links. Back returns to the browse page with its filters and scroll position.
 * Admins get "Edit metadata". Dependencies: react-router-dom,
 * useMarketplaceEntry, useMe, i18n.store, marketplace components, ui primitives
 */
import { useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useMarketplaceEntry } from '../hooks/useMarketplace';
import { useMe } from '../hooks/useMe';
import { useI18n } from '../stores/i18n.store';
import { MarketplaceEditStatusModal } from '../components/modals/MarketplaceEditStatusModal';
import { MarketplaceTile } from '../components/marketplace/MarketplaceCard';
import {
  DetailPanel,
  DetailTabList,
  type DetailTab,
} from '../components/marketplace/MarketplaceDetailTabs';
import {
  STATUS_TONE,
  TRUST_TONE,
  displayName,
  publisherOf,
  safeHttpUrl,
  statusLabelKey,
  trustLevel,
} from '../components/marketplace/marketplaceUtils';
import { Button } from '../components/ui/Button';
import { Icon } from '../components/ui/Icon';
import { StatusPill } from '../components/ui/StatusPill';

const ADVISORY_CLASS = {
  INFO: 'bg-info-surface border-info-border text-info-fg',
  WARNING: 'bg-warning-surface border-warning-border text-warning-fg',
  CRITICAL: 'bg-danger-surface border-danger-border text-danger-fg',
} as const;

const LINK_BTN = 'btn btn-md press-effect no-underline';
const SCROLLED_AT = 120;

export function MarketplaceDetailPage() {
  const { t } = useI18n();
  const { slug = '' } = useParams();
  const { data: entry, isLoading } = useMarketplaceEntry(slug);
  const { data: me } = useMe();
  const navigate = useNavigate();
  const location = useLocation();
  const [editOpen, setEditOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [tab, setTab] = useState<DetailTab>('overview');

  const isAdmin = !!me?.isAdmin;

  // history entry 0 ("default" key) means the page was opened directly.
  function goBack() {
    if (location.key !== 'default') navigate(-1);
    else navigate('/app/marketplace');
  }

  const backButton = (
    <Button variant="ghost" size="sm" onClick={goBack} className="-ml-2 shrink-0">
      <Icon name="chevron_left" size={20} />
      {t('marketplaceBack')}
    </Button>
  );

  if (isLoading) {
    return (
      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-8" aria-busy="true">
        <div className="mx-auto max-w-5xl space-y-4">
          <span className="sr-only">{t('loading')}</span>
          {backButton}
          <div aria-hidden="true" className="glass h-40 rounded-[24px] p-6">
            <div className="flex items-center gap-4">
              <div className="skeleton h-[72px] w-[72px] rounded-[20px]" />
              <div className="flex-1 space-y-2">
                <div className="skeleton h-5 w-1/2 rounded-full" />
                <div className="skeleton h-3 w-1/4 rounded-full" />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!entry) {
    return (
      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-8">
        <div className="mx-auto max-w-5xl space-y-6">
          {backButton}
          <div className="glass flex flex-col items-center gap-3 rounded-[20px] p-12 text-center">
            <Icon name="search_off" size={40} className="text-[color:var(--text-muted)]" />
            <p className="m-0 text-sm text-[color:var(--text-secondary)]">
              {t('marketplaceNotFound')}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const publisher = publisherOf(entry.gitUrl);
  const trust = trustLevel(entry);
  const artifact = safeHttpUrl(entry.artifactUrl);

  return (
    <div
      onScroll={(e) => setScrolled(e.currentTarget.scrollTop > SCROLLED_AT)}
      className="flex-1 overflow-y-auto"
    >
      <div className="glass-chrome sticky top-0 z-20 px-4 py-2 sm:px-8">
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          {backButton}
          <div
            aria-hidden="true"
            className={`flex min-w-0 flex-1 items-center gap-2 transition-opacity duration-short ease-standard ${scrolled ? 'opacity-100' : 'opacity-0'}`}
          >
            <MarketplaceTile entry={entry} size={28} />
            <span className="truncate text-sm font-semibold text-[color:var(--text-primary)]">
              {displayName(entry)}
            </span>
          </div>
          {scrolled && (
            <a
              href={entry.gitUrl}
              target="_blank"
              rel="noopener noreferrer"
              tabIndex={-1}
              aria-hidden="true"
              className={`${LINK_BTN} btn-primary btn-sm ml-auto`}
            >
              {t('marketplaceViewOnGithub')}
            </a>
          )}
        </div>
      </div>

      <div className="px-4 pb-10 pt-4 sm:px-8">
        <div className="mx-auto flex max-w-5xl animate-scale-in flex-col gap-5">
          <section className="glass flex flex-col gap-5 rounded-[24px] p-5 sm:p-7">
            <div className="flex flex-wrap items-start gap-4">
              <MarketplaceTile entry={entry} size={72} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="m-0 text-[26px] font-bold leading-tight tracking-tight text-[color:var(--text-primary)]">
                    {displayName(entry)}
                  </h1>
                  {entry.verified && (
                    <Icon
                      name="verified"
                      size={24}
                      filled
                      label={t('marketplaceVerified')}
                      className="text-[color:var(--primary)]"
                    />
                  )}
                </div>
                {publisher && (
                  <p className="m-0 mt-0.5 text-sm text-[color:var(--text-secondary)]">
                    {t('marketplaceBy', { publisher })}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <StatusPill tone={STATUS_TONE[entry.status]}>
                    {t(statusLabelKey(entry.status))}
                  </StatusPill>
                  {trust === 'caution' && (
                    <StatusPill tone={TRUST_TONE.caution} icon="shield">
                      {t('marketplaceTrustCaution')}
                    </StatusPill>
                  )}
                  {entry.dsfVersionMin && (
                    <StatusPill tone="neutral">
                      {t('marketplaceDsfVersion')} ≥ {entry.dsfVersionMin}
                    </StatusPill>
                  )}
                  {entry.latestReleaseTag && (
                    <StatusPill tone="info" icon="sell">
                      {entry.latestReleaseTag}
                    </StatusPill>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <a
                href={entry.gitUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`${LINK_BTN} btn-primary`}
              >
                <Icon name="code" size={18} />
                {t('marketplaceViewOnGithub')}
              </a>
              {artifact && (
                <a
                  href={artifact}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${LINK_BTN} btn-secondary`}
                >
                  <Icon name="download" size={18} />
                  {t('marketplaceDownloadArtifact')}
                </a>
              )}
              {isAdmin && (
                <Button variant="secondary" onClick={() => setEditOpen(true)}>
                  <Icon name="edit" size={18} />
                  {t('marketplaceEditMeta')}
                </Button>
              )}
            </div>
          </section>

          {entry.advisorySeverity && (
            <div
              role="note"
              className={`rounded-[18px] border p-4 ${ADVISORY_CLASS[entry.advisorySeverity]}`}
            >
              <div className="flex items-center gap-2 text-sm font-bold">
                <Icon name="warning" size={20} />
                {t('marketplaceAdvisory')} · {entry.advisorySeverity}
              </div>
              {entry.advisoryText && <p className="m-0 mt-1.5 text-[13px]">{entry.advisoryText}</p>}
            </div>
          )}

          <DetailTabList value={tab} onChange={setTab} />
          <DetailPanel tab={tab} entry={entry} />
        </div>
      </div>

      {isAdmin && (
        <MarketplaceEditStatusModal
          open={editOpen}
          onClose={() => setEditOpen(false)}
          entryId={entry.id}
          currentStatus={entry.status}
          slug={entry.slug}
          entry={entry}
        />
      )}
    </div>
  );
}
