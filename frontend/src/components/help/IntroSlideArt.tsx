/**
 * IntroSlideArt.tsx – the small schematic illustrations of the help page's intro
 * slides, built from divs, one inline SVG for the connector lines and Material
 * Symbols icons. Decorative only (aria-hidden): the slide text carries the meaning.
 * Dependencies: i18n store, Icon, i18n/en (TranslationKey).
 */
import { useI18n } from '../../stores/i18n.store';
import type { TranslationKey } from '../../i18n/en';
import { Icon } from '../ui/Icon';

const NODE =
  'flex min-w-0 flex-col items-center gap-1 rounded-control border border-[color:var(--border)] bg-[color:var(--bg-card)] px-2.5 py-2 text-center text-xs font-medium text-[color:var(--text-primary)]';
const NODE_ACCENT =
  'border-[color:var(--accent)] bg-[color:var(--accent-surface)] text-[color:var(--accent-on-surface)]';

interface Node {
  icon: string;
  labelKey: TranslationKey;
}

function NodeBox({ node, accent }: { node: Node; accent?: boolean }) {
  const { t } = useI18n();
  return (
    <div className={`${NODE} ${accent ? NODE_ACCENT : ''}`}>
      <Icon name={node.icon} size={22} className="text-[color:var(--accent)]" />
      <span className="max-w-full break-words">{t(node.labelKey)}</span>
    </div>
  );
}

/** Lines from one node on top to `count` nodes below. */
function Fan({ count }: { count: number }) {
  const xs = Array.from({ length: count }, (_, i) => ((i + 0.5) / count) * 100);
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="h-8 w-full" aria-hidden="true">
      {xs.map((x) => (
        <path
          key={x}
          d={`M50 0 C50 14 ${x} 10 ${x} 24`}
          fill="none"
          stroke="var(--text-muted)"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

function Fanout({ top, bottom }: { top: Node; bottom: Node[] }) {
  return (
    <div className="mx-auto w-full max-w-sm" aria-hidden="true">
      <div className="mx-auto w-28">
        <NodeBox node={top} accent />
      </div>
      <Fan count={bottom.length} />
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${bottom.length}, minmax(0, 1fr))` }}
      >
        {bottom.map((n) => (
          <NodeBox key={n.labelKey} node={n} />
        ))}
      </div>
    </div>
  );
}

function Steps({ steps }: { steps: Node[] }) {
  return (
    <div
      className="mx-auto flex max-w-md flex-wrap items-center justify-center gap-x-1 gap-y-2"
      aria-hidden="true"
    >
      {steps.map((s, i) => (
        <div key={s.labelKey} className="flex items-center gap-1">
          <div className="w-24">
            <NodeBox node={s} accent={i === steps.length - 1} />
          </div>
          {i < steps.length - 1 && (
            <Icon name="arrow_forward" size={18} className="text-[color:var(--text-muted)]" />
          )}
        </div>
      ))}
    </div>
  );
}

export function FlowArt() {
  return (
    <Steps
      steps={[
        { icon: 'hub', labelKey: 'introS1_portal' },
        { icon: 'data_object', labelKey: 'introS1_bundle' },
        { icon: 'dns', labelKey: 'introS1_dsf' },
      ]}
    />
  );
}

export function EntitiesArt() {
  return (
    <Fanout
      top={{ icon: 'corporate_fare', labelKey: 'introS2_organization' }}
      bottom={[
        { icon: 'contacts', labelKey: 'introS2_contacts' },
        { icon: 'dns', labelKey: 'introS2_endpoints' },
        { icon: 'workspace_premium', labelKey: 'introS2_certificates' },
        { icon: 'group_work', labelKey: 'introS2_memberships' },
      ]}
    />
  );
}

export function ApprovalArt() {
  return (
    <Steps
      steps={[
        { icon: 'edit_document', labelKey: 'introS3_draft' },
        { icon: 'fact_check', labelKey: 'introS3_approval' },
        { icon: 'cloud_done', labelKey: 'introS3_published' },
      ]}
    />
  );
}

export function IncidentArt() {
  return (
    <Steps
      steps={[
        { icon: 'campaign', labelKey: 'introS4_report' },
        { icon: 'task_alt', labelKey: 'introS4_confirm' },
        { icon: 'block', labelKey: 'introS4_suspend' },
        { icon: 'lock_open', labelKey: 'introS4_lift' },
      ]}
    />
  );
}

const STACK = ['React / TypeScript', 'Node.js / Express', 'MySQL', 'Redis', 'Docker', 'Apache-2.0'];

/** Stack and licence as plain badges; these are product names, not translated. */
export function ProjectArt() {
  return (
    <ul className="flex flex-wrap justify-center gap-2" aria-hidden="true">
      {STACK.map((name) => (
        <li
          key={name}
          className="rounded-full border border-[color:var(--border)] bg-[color:var(--bg-card)] px-3 py-1 text-xs font-medium text-[color:var(--text-primary)]"
        >
          {name}
        </li>
      ))}
    </ul>
  );
}
