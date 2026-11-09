/**
 * VerbundPills.tsx – Toggleable pills for each parent_organization in the
 * visible org set (multi-select, aria-pressed). An active pill highlights its
 * network: edges within it fade in on the map (GeoMapEdges). The Verbund
 * colour is a dot and a tint; the label stays in the text colour for AA.
 * Dependencies: lib/peerEdges, i18n.store.
 */
import type { CSSProperties } from 'react';
import { verbundColor, verbundLabel } from '../../lib/peerEdges';
import { useI18n } from '../../stores/i18n.store';

interface Props {
  counts: Map<string, number>; // parent_organization -> visible member count
  active: Set<string>; // parent_organizations toggled "on"
  onToggle: (parentOrg: string) => void;
}

export function VerbundPills({ counts, active, onToggle }: Props) {
  const { t } = useI18n();
  if (counts.size === 0) return null;
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return (
    <div role="group" aria-label={t('mapFilterNetworkLabel')} className="flex flex-wrap gap-1.5">
      {entries.map(([parent, n]) => {
        const on = active.has(parent);
        const color = verbundColor(parent);
        return (
          <button
            key={parent}
            type="button"
            aria-pressed={on}
            title={parent}
            onClick={() => onToggle(parent)}
            style={{ '--verbund': color } as CSSProperties}
            className={`press-effect inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors duration-short ease-standard focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-ring)] ${
              on
                ? 'border-[color:var(--verbund)] bg-[color:color-mix(in_srgb,var(--verbund)_14%,transparent)] text-[color:var(--text-primary)]'
                : 'border-[color:var(--border)] text-[color:var(--text-secondary)] hover:bg-[color:var(--bg-hover)] hover:text-[color:var(--text-primary)]'
            }`}
          >
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-full"
              style={{ background: color }}
            />
            {verbundLabel(parent)} ({n})
          </button>
        );
      })}
    </div>
  );
}
