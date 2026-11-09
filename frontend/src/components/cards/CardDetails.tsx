/**
 * CardDetails.tsx – the simplified/detailed split of one entity card (state: useCardDetails).
 * `DetailsToggle` is the quiet per-card "Show details" button, rendered only in the
 * simplified view. `Details` wraps content that only belongs to the detailed view and
 * folds it with the Collapse motion.
 * Dependencies: useCardDetails, Collapse, Button, Icon, i18n store.
 */
import type { ReactNode } from 'react';
import type { CardDetails } from '../../hooks/useCardDetails';
import { useI18n } from '../../stores/i18n.store';
import { Collapse } from '../layout/Collapse';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';

export function DetailsToggle({ details }: { details: CardDetails }) {
  const { t } = useI18n();
  if (!details.canToggle) return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-expanded={details.expanded}
      onClick={details.toggle}
      className="mt-2 self-start text-[color:var(--text-secondary)]"
    >
      <Icon
        name="chevron_right"
        size={14}
        className={`transition-transform duration-short ease-spring ${
          details.expanded ? 'rotate-90' : ''
        }`}
      />
      {details.expanded ? t('cardHideDetails') : t('cardShowDetails')}
    </Button>
  );
}

/** Content for the detailed view only. */
export function Details({ show, children }: { show: boolean; children: ReactNode }) {
  return <Collapse open={show}>{children}</Collapse>;
}
