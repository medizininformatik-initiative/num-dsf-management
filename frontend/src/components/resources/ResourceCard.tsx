/**
 * ResourceCard.tsx — one external DSF resource as a card: title, one-line
 * description, host and an outward-arrow affordance.
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
import { hostOf, type DsfResource } from '../../lib/dsfResources';

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

  return (
    <a
      href={resource.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${resource.title}, ${t('dsfResourcesOpensExternally', { host })}`}
      aria-describedby={descId}
      style={style}
      className={`group surface-card hover-lift press-effect flex h-full min-w-0 items-start gap-3 text-[color:var(--text-primary)] no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-ring)] ${
        featured ? 'p-5' : 'p-4'
      } ${className}`}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={`font-semibold leading-snug ${featured ? 'text-base' : 'text-sm'}`}>
          {resource.title}
        </span>
        <span
          id={descId}
          className="line-clamp-2 text-sm leading-snug text-[color:var(--text-secondary)]"
        >
          {t(resource.descKey)}
        </span>
        <span className="mt-1 inline-flex min-w-0 items-center gap-1 text-xs text-[color:var(--text-muted)]">
          <Icon name="language" size={14} />
          <span className="truncate">{host}</span>
        </span>
      </span>
      <Icon
        name="arrow_outward"
        size={16}
        className="shrink-0 text-[color:var(--text-muted)] transition-colors duration-short ease-standard group-hover:text-[color:var(--primary)] group-focus-visible:text-[color:var(--primary)]"
      />
    </a>
  );
}
