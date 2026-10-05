/**
 * ResourceCard.tsx — one external DSF resource as a glass card: tinted icon
 * tile, title, one-line description, host and an outward-arrow affordance.
 * The whole card is a link that opens in a new tab (rel="noopener noreferrer");
 * its accessible name is the title plus "opens <host> in a new tab", the
 * description is attached via aria-describedby. `featured` is the larger
 * variant used in the "Start here" row. Hover and press feedback come from
 * .hover-lift / .press-effect (spring easing, Reduce Motion aware).
 * Dependencies: react, i18n.store, ui/Icon, lib/dsfResources
 */
import { useId, type CSSProperties } from 'react';
import { useI18n } from '../../stores/i18n.store';
import { Icon } from '../ui/Icon';
import { hostOf, type DsfResource, type ResourceCategory } from '../../lib/dsfResources';

const TILE_TONE: Record<ResourceCategory, string> = {
  gettingStarted: 'bg-success-surface border-success-border text-success-fg',
  documentation: 'bg-info-surface border-info-border text-info-fg',
  processPlugins: 'bg-info-surface border-info-border text-info-fg',
  specifications: 'bg-neutral-surface border-neutral-border text-neutral-fg',
  community: 'bg-neutral-surface border-neutral-border text-neutral-fg',
  networks: 'bg-success-surface border-success-border text-success-fg',
};

interface Props {
  resource: DsfResource;
  featured?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function ResourceCard({ resource, featured = false, className = '', style }: Props) {
  const { t } = useI18n();
  const descId = useId();
  const host = hostOf(resource.url);
  const tile = featured ? 'h-12 w-12 rounded-[14px]' : 'h-10 w-10 rounded-[12px]';

  return (
    <a
      href={resource.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${resource.title}, ${t('dsfResourcesOpensExternally', { host })}`}
      aria-describedby={descId}
      style={style}
      className={`group glass hover-lift press-effect flex h-full min-w-0 items-start gap-3.5 rounded-[20px] text-[color:var(--text-primary)] no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--primary)] ${
        featured ? 'p-5' : 'p-4'
      } ${className}`}
    >
      <span
        aria-hidden="true"
        className={`flex shrink-0 items-center justify-center border ${tile} ${TILE_TONE[resource.category]}`}
      >
        <Icon name={resource.icon} size={featured ? 26 : 22} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={`font-semibold leading-snug ${featured ? 'text-[16px]' : 'text-[14px]'}`}>
          {resource.title}
        </span>
        <span
          id={descId}
          className="line-clamp-2 text-[13px] leading-snug text-[color:var(--text-secondary)]"
        >
          {t(resource.descKey)}
        </span>
        <span className="mt-1 inline-flex min-w-0 items-center gap-1 text-[12px] text-[color:var(--text-muted)]">
          <Icon name="language" size={14} />
          <span className="truncate">{host}</span>
        </span>
      </span>
      <Icon
        name="arrow_outward"
        size={18}
        className="shrink-0 text-[color:var(--text-muted)] transition-colors duration-short ease-standard group-hover:text-[color:var(--primary)] group-focus-visible:text-[color:var(--primary)]"
      />
    </a>
  );
}
