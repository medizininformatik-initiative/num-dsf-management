/**
 * IncidentFlowSection.tsx – the collapsible "How an incident is handled"
 * section above the incident list: a disclosure button with the process
 * diagram below. The open/closed choice is remembered in localStorage (a
 * blocked store only means it is not remembered); without a choice the section
 * is open when there are no incidents to look at and closed otherwise.
 * Dependencies: IncidentFlowDiagram, Icon, i18n store.
 */
import { useId, useState } from 'react';
import type { FlowNodeId } from '../../lib/incidentFlow';
import { useI18n } from '../../stores/i18n.store';
import { Icon } from '../ui/Icon';
import { IncidentFlowDiagram } from './IncidentFlowDiagram';

export const INCIDENT_FLOW_STORAGE_KEY = 'incidentFlowOpen';

function readChoice(): boolean | null {
  try {
    const v = localStorage.getItem(INCIDENT_FLOW_STORAGE_KEY);
    return v === '1' ? true : v === '0' ? false : null;
  } catch {
    return null;
  }
}

interface IncidentFlowSectionProps {
  /** Open by default (no incidents to look at); a remembered choice wins. */
  defaultOpen: boolean;
  activeStep?: FlowNodeId | null;
}

export function IncidentFlowSection({ defaultOpen, activeStep = null }: IncidentFlowSectionProps) {
  const { t } = useI18n();
  const bodyId = useId();
  const [choice, setChoice] = useState<boolean | null>(readChoice);
  const open = choice ?? defaultOpen;

  function toggle() {
    const next = !open;
    setChoice(next);
    try {
      localStorage.setItem(INCIDENT_FLOW_STORAGE_KEY, next ? '1' : '0');
    } catch {
      // not remembered, still toggles
    }
  }

  return (
    <section className="surface-card p-4" data-testid="incident-flow-section">
      <h2 className="text-sm font-semibold text-[color:var(--text-primary)]">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={toggle}
          className="press-effect flex w-full items-center gap-2 rounded-control text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-ring)]"
        >
          <Icon name="account_tree" size={18} className="shrink-0 text-[color:var(--accent)]" />
          <span className="flex-1">{t('incidentFlowTitle')}</span>
          <Icon
            name="expand_more"
            size={20}
            className={`shrink-0 transition-transform duration-short ${open ? 'rotate-180' : ''}`}
          />
        </button>
      </h2>
      <div id={bodyId} hidden={!open} className="mt-3">
        {open && <IncidentFlowDiagram activeStep={activeStep} />}
      </div>
    </section>
  );
}
