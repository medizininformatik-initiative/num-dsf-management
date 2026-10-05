/**
 * MarketplaceDetailTabs.tsx — the segmented control and the four panels of the
 * marketplace detail page: Overview (description, repo facts, trust signals),
 * Releases (timeline), Compatibility (DSF metadata) and Links. Only the active
 * panel is rendered; the control follows the WAI-ARIA tabs pattern (roving
 * tabindex, arrow keys, Home/End).
 * Dependencies: react-router-dom, i18n.store, ui (Icon, StatusPill),
 *               dateUtils, marketplaceUtils
 */
import { useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../../stores/i18n.store';
import { Icon } from '../ui/Icon';
import { StatusPill } from '../ui/StatusPill';
import { formatDate } from '../../lib/dateUtils';
import type { MarketplaceDetail } from '../../api/marketplace.api';
import { safeHttpUrl } from './marketplaceUtils';

export type DetailTab = 'overview' | 'releases' | 'compat' | 'links';
const TABS: DetailTab[] = ['overview', 'releases', 'compat', 'links'];

export function DetailTabList({
  value,
  onChange,
}: {
  value: DetailTab;
  onChange: (tab: DetailTab) => void;
}) {
  const { t } = useI18n();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const labels: Record<DetailTab, string> = {
    overview: t('marketplaceTabOverview'),
    releases: t('marketplaceTabReleases'),
    compat: t('marketplaceTabCompat'),
    links: t('marketplaceTabLinks'),
  };

  function onKeyDown(e: React.KeyboardEvent, i: number) {
    let next = i;
    if (e.key === 'ArrowRight') next = (i + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    else return;
    e.preventDefault();
    onChange(TABS[next]);
    refs.current[TABS[next]]?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label={t('marketplaceTabsLabel')}
      className="glass-thin inline-flex max-w-full gap-1 overflow-x-auto rounded-full p-1"
    >
      {TABS.map((tab, i) => {
        const active = tab === value;
        return (
          <button
            key={tab}
            ref={(el) => {
              refs.current[tab] = el;
            }}
            role="tab"
            id={`mp-tab-${tab}`}
            aria-selected={active}
            aria-controls={`mp-panel-${tab}`}
            tabIndex={active ? 0 : -1}
            type="button"
            onClick={() => onChange(tab)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`press-effect min-h-[36px] whitespace-nowrap rounded-full px-4 text-[13px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--primary)] ${
              active
                ? 'bg-[color:var(--accent-solid)] text-white'
                : 'text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]'
            }`}
          >
            {labels[tab]}
          </button>
        );
      })}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <dt className="mb-1 text-[11px] font-bold uppercase tracking-wider text-[color:var(--text-muted)]">
        {label}
      </dt>
      <dd className="m-0 text-[13px] text-[color:var(--text-secondary)]">{children}</dd>
    </div>
  );
}

function Dash() {
  return <span className="text-[color:var(--text-muted)]">—</span>;
}

function Chips({ items, mono }: { items: string[]; mono?: boolean }) {
  if (items.length === 0) return <Dash />;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((it) => (
        <span
          key={it}
          className={`rounded-full bg-[color:var(--bg-hover)] px-2.5 py-0.5 text-xs font-semibold text-[color:var(--text-secondary)] ${mono ? 'font-mono font-normal' : ''}`}
        >
          {it}
        </span>
      ))}
    </div>
  );
}

function Panel({ tab, children }: { tab: DetailTab; children: ReactNode }) {
  return (
    <div
      role="tabpanel"
      id={`mp-panel-${tab}`}
      aria-labelledby={`mp-tab-${tab}`}
      tabIndex={0}
      className="glass animate-fade-in rounded-[20px] p-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--primary)] sm:p-6"
    >
      {children}
    </div>
  );
}

function Overview({ entry }: { entry: MarketplaceDetail }) {
  const { t } = useI18n();
  const paragraphs = (entry.description ?? '').split(/\n{2,}/).filter((p) => p.trim());
  return (
    <Panel tab="overview">
      <div className="grid gap-6 md:grid-cols-[1fr_16rem]">
        <div className="space-y-3 text-[15px] leading-relaxed text-[color:var(--text-primary)]">
          {paragraphs.length > 0 ? (
            paragraphs.map((p, i) => (
              <p key={i} className="m-0 whitespace-pre-line">
                {p}
              </p>
            ))
          ) : (
            <p className="m-0 text-[color:var(--text-muted)]">{t('marketplaceNoDescription')}</p>
          )}
          {entry.topics.length > 0 && (
            <div className="pt-2">
              <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-[color:var(--text-muted)]">
                {t('marketplaceTopics')}
              </div>
              <Chips items={entry.topics} />
            </div>
          )}
        </div>

        <aside className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-1.5">
            {entry.verified && (
              <StatusPill tone="success" icon="verified">
                {t('marketplaceVerified')}
              </StatusPill>
            )}
            {entry.licenseOk && (
              <StatusPill tone="success" icon="gavel">
                {t('marketplaceLicenseOk')}
                {entry.license ? ` · ${entry.license}` : ''}
              </StatusPill>
            )}
            {entry.stale && (
              <StatusPill tone="danger" icon="schedule">
                {t('marketplaceStale')}
              </StatusPill>
            )}
            {entry.archived && (
              <StatusPill tone="warning" icon="inventory_2">
                {t('marketplaceArchived')}
              </StatusPill>
            )}
          </div>
          <dl className="m-0 divide-y divide-[color:var(--border)]">
            <Field label={t('marketplaceTabReleases')}>{entry.latestReleaseTag ?? <Dash />}</Field>
            <Field label="GitHub">
              <span className="flex flex-wrap gap-x-3 gap-y-1">
                <span title={t('marketplaceStarsLabel', { n: entry.stars })}>★ {entry.stars}</span>
                <span title={t('marketplaceForksLabel', { n: entry.forks })}>⑂ {entry.forks}</span>
                <span title={t('marketplaceIssuesLabel', { n: entry.openIssues })}>
                  ⓘ {entry.openIssues}
                </span>
                {entry.language && <span>{entry.language}</span>}
              </span>
            </Field>
            {entry.supersededBy && (
              <Field label={t('marketplaceSupersededBy')}>
                <Link
                  to={`/app/marketplace/${entry.supersededBy}`}
                  className="font-semibold text-[color:var(--primary)]"
                >
                  {entry.supersededBy}
                </Link>
              </Field>
            )}
          </dl>
        </aside>
      </div>
    </Panel>
  );
}

function Releases({ entry }: { entry: MarketplaceDetail }) {
  const { t, lang } = useI18n();
  return (
    <Panel tab="releases">
      {entry.releases.length === 0 ? (
        <p className="m-0 text-sm text-[color:var(--text-muted)]">{t('marketplaceNoReleases')}</p>
      ) : (
        <ol className="m-0 list-none p-0">
          {entry.releases.map((r, i) => {
            const latest = r.tag === entry.latestReleaseTag || (i === 0 && !entry.latestReleaseTag);
            return (
              <li key={r.tag} className="relative flex gap-4 pb-5 last:pb-0">
                <span aria-hidden="true" className="relative mt-1.5 flex flex-col items-center">
                  <span
                    className={`h-3 w-3 rounded-full ${latest ? 'bg-[color:var(--primary)]' : 'border-2 border-[color:var(--border-strong)] bg-transparent'}`}
                  />
                  <span className="mt-1 w-px flex-1 bg-[color:var(--border)] [li:last-child_&]:hidden" />
                </span>
                <div className="flex flex-1 flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-semibold text-[color:var(--text-primary)]">
                    {r.tag}
                    {latest && <StatusPill tone="info">{t('marketplaceLatest')}</StatusPill>}
                  </span>
                  <span className="text-xs text-[color:var(--text-muted)]">
                    {r.publishedAt ? formatDate(r.publishedAt, lang) : ''}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}

function Compatibility({ entry }: { entry: MarketplaceDetail }) {
  const { t } = useI18n();
  const artifact = safeHttpUrl(entry.artifactUrl);
  return (
    <Panel tab="compat">
      <dl className="m-0 divide-y divide-[color:var(--border)]">
        <Field label={t('marketplaceDsfVersion')}>
          {entry.dsfVersionMin ? <span>≥ {entry.dsfVersionMin}</span> : <Dash />}
        </Field>
        <Field label={t('marketplaceProcessId')}>
          <Chips items={entry.processIdentifiers} mono />
        </Field>
        <Field label={t('marketplaceRequiredRoles')}>
          <Chips items={entry.requiredRoles} />
        </Field>
        <Field label={t('marketplaceMessageNames')}>
          <Chips items={entry.messageNames} mono />
        </Field>
        <Field label={t('marketplaceArtifact')}>
          {artifact ? (
            <a
              href={artifact}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all font-semibold text-[color:var(--primary)]"
            >
              {artifact}
            </a>
          ) : (
            <Dash />
          )}
        </Field>
        <Field label={t('marketplaceMetaSource')}>
          <StatusPill tone="neutral">{entry.metadataSource}</StatusPill>
        </Field>
      </dl>
    </Panel>
  );
}

function LinkRow({ href, icon, label }: { href: string; icon: string; label: string }) {
  return (
    <li>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="press-effect flex min-h-[44px] items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold text-[color:var(--text-primary)] hover:bg-[color:var(--bg-hover)]"
      >
        <Icon name={icon} size={20} className="text-[color:var(--primary)]" />
        <span className="flex-1">{label}</span>
        <Icon name="open_in_new" size={16} className="text-[color:var(--text-muted)]" />
      </a>
    </li>
  );
}

function Links({ entry }: { entry: MarketplaceDetail }) {
  const { t } = useI18n();
  const base = entry.gitUrl.replace(/\.git\/?$|\/$/, '');
  const homepage = safeHttpUrl(entry.homepage);
  const artifact = safeHttpUrl(entry.artifactUrl);
  return (
    <Panel tab="links">
      <ul className="m-0 list-none space-y-1 p-0">
        <LinkRow href={entry.gitUrl} icon="code" label={t('marketplaceViewOnGithub')} />
        {homepage && <LinkRow href={homepage} icon="menu_book" label={t('marketplaceDocs')} />}
        <LinkRow href={`${base}/releases`} icon="sell" label={t('marketplaceReleasesLink')} />
        <LinkRow href={`${base}/issues`} icon="bug_report" label={t('marketplaceIssuesLink')} />
        {artifact && (
          <LinkRow href={artifact} icon="download" label={t('marketplaceDownloadArtifact')} />
        )}
      </ul>
    </Panel>
  );
}

export function DetailPanel({ tab, entry }: { tab: DetailTab; entry: MarketplaceDetail }) {
  if (tab === 'releases') return <Releases entry={entry} />;
  if (tab === 'compat') return <Compatibility entry={entry} />;
  if (tab === 'links') return <Links entry={entry} />;
  return <Overview entry={entry} />;
}
