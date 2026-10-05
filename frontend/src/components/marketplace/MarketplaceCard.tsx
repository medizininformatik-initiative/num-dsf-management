/**
 * MarketplaceCard.tsx — glass process card linking to the detail page. Hierarchy:
 * initial tile + name (+ verified mark) + publisher, one-line-ish description,
 * key badges (status, DSF floor, latest release, caution), role chips, and a
 * footer with the last update and the "View details" affordance. Admin actions
 * live outside the card (on the page), so the link never contains buttons.
 * Dependencies: react-router-dom, i18n.store, marketplaceUtils, ui (Icon,
 *               StatusPill), dateUtils.
 */
import { Link } from 'react-router-dom';
import { useI18n } from '../../stores/i18n.store';
import { Icon } from '../ui/Icon';
import { StatusPill } from '../ui/StatusPill';
import { relTime } from '../../lib/dateUtils';
import type { MarketplaceEntry } from '../../api/marketplace.api';
import {
  STATUS_TONE,
  TRUST_TONE,
  displayName,
  hueOf,
  initialOf,
  publisherOf,
  statusLabelKey,
  trustLevel,
} from './marketplaceUtils';

const ADVISORY_CLASS: Record<NonNullable<MarketplaceEntry['advisorySeverity']>, string> = {
  INFO: 'bg-info-surface border-info-border text-info-fg',
  WARNING: 'bg-warning-surface border-warning-border text-warning-fg',
  CRITICAL: 'bg-danger-surface border-danger-border text-danger-fg',
};

const MAX_ROLES = 4;

export function MarketplaceTile({
  entry,
  size = 48,
}: {
  entry: Pick<MarketplaceEntry, 'name' | 'gitUrl'>;
  size?: number;
}) {
  const hue = hueOf(displayName(entry));
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 select-none items-center justify-center font-bold text-white"
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        fontSize: size * 0.44,
        background: `linear-gradient(145deg, hsl(${hue} 62% 46%), hsl(${(hue + 40) % 360} 62% 36%))`,
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.35), 0 1px 3px rgba(0,0,0,0.18)',
      }}
    >
      {initialOf(entry)}
    </span>
  );
}

export function MarketplaceCard({ entry }: { entry: MarketplaceEntry }) {
  const { t } = useI18n();
  const publisher = publisherOf(entry.gitUrl);
  const trust = trustLevel(entry);

  return (
    <Link
      to={`/app/marketplace/${entry.slug}`}
      className="glass hover-lift press-effect flex h-full min-w-0 flex-col gap-3 rounded-[20px] p-4 text-[color:var(--text-primary)] no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--primary)]"
    >
      {entry.advisorySeverity && (
        <div
          className={`inline-flex items-center gap-1.5 self-start rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${ADVISORY_CLASS[entry.advisorySeverity]}`}
        >
          <Icon name="warning" size={14} />
          {entry.advisorySeverity}
        </div>
      )}

      <div className="flex items-center gap-3">
        <MarketplaceTile entry={entry} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[15px] font-semibold leading-tight">
              {displayName(entry)}
            </span>
            {entry.verified && (
              <Icon
                name="verified"
                size={18}
                filled
                label={t('marketplaceVerified')}
                className="shrink-0 text-[color:var(--primary)]"
              />
            )}
          </div>
          {publisher && (
            <div className="truncate text-xs text-[color:var(--text-secondary)]">
              {t('marketplaceBy', { publisher })}
            </div>
          )}
        </div>
      </div>

      {entry.description ? (
        <p className="m-0 line-clamp-2 text-[13px] leading-snug text-[color:var(--text-secondary)]">
          {entry.description}
        </p>
      ) : (
        <p className="m-0 text-[13px] italic leading-snug text-[color:var(--text-muted)]">
          {t('marketplaceNoDescription')}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <StatusPill tone={STATUS_TONE[entry.status]}>{t(statusLabelKey(entry.status))}</StatusPill>
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
        {trust === 'caution' && !entry.advisorySeverity && (
          <StatusPill tone={TRUST_TONE.caution} icon="shield">
            {t('marketplaceTrustCaution')}
          </StatusPill>
        )}
      </div>

      {entry.requiredRoles.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {entry.requiredRoles.slice(0, MAX_ROLES).map((role) => (
            <span
              key={role}
              className="rounded-full bg-[color:var(--bg-hover)] px-2 py-0.5 text-[11px] font-semibold text-[color:var(--text-secondary)]"
            >
              {role}
            </span>
          ))}
          {entry.requiredRoles.length > MAX_ROLES && (
            <span className="text-[11px] text-[color:var(--text-muted)]">
              +{entry.requiredRoles.length - MAX_ROLES}
            </span>
          )}
        </div>
      )}

      <div className="mt-auto flex items-center gap-3 border-t border-[color:var(--border)] pt-3 text-xs text-[color:var(--text-muted)]">
        <span
          className="inline-flex items-center gap-1"
          title={t('marketplaceStarsLabel', { n: entry.stars })}
        >
          <Icon name="star" size={14} />
          {entry.stars}
        </span>
        {entry.lastCommitAt && (
          <span className="truncate">
            {t('marketplaceUpdated', { ago: relTime(entry.lastCommitAt, t) })}
          </span>
        )}
        <span className="ml-auto inline-flex items-center gap-0.5 font-semibold text-[color:var(--primary)]">
          {t('marketplaceViewDetails')}
          <Icon name="chevron_right" size={16} />
        </span>
      </div>
    </Link>
  );
}
