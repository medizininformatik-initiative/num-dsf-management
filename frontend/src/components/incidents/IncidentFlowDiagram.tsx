/**
 * IncidentFlowDiagram.tsx – the incident process as a workflow diagram in the
 * style of a node editor: dot-grid canvas, rounded nodes with icon, label and
 * sub-line, small connector dots, smooth edges with branch pills, coloured by
 * category with the portal's tone tokens. Positions and edge paths come from
 * lib/incidentFlow (no DOM measuring); the container width only decides
 * between the wide layout and the vertical one below 720 px. Each node is a
 * button that opens a short explanation below the canvas (Escape closes);
 * `activeStep` marks the step an incident is in. The canvas is a labelled
 * group of buttons in reading order; the edges are decorative, the panel
 * names the following steps.
 * Dependencies: lib/incidentFlow, Icon, i18n store, react.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import {
  FLOW_EDGES,
  FLOW_NODES,
  NODE_SIZE,
  SMALL_NODE_SIZE,
  WIDE_MIN_WIDTH,
  edgeGeometry,
  flowLayout,
  type FlowCategory,
  type FlowNodeDef,
  type FlowNodeId,
  type FlowPill,
} from '../../lib/incidentFlow';
import type { TranslationKey } from '../../i18n/en';
import { useI18n } from '../../stores/i18n.store';
import { Icon } from '../ui/Icon';

const TONE: Record<FlowCategory, string> = {
  human:
    'border-[color:var(--accent)] bg-[color:var(--accent-surface)] text-[color:var(--accent-on-surface)]',
  auto: 'border-success-border bg-success-surface text-success-fg',
  suspend: 'border-danger-border bg-danger-surface text-danger-fg',
  wait: 'border-warning-border bg-warning-surface text-warning-fg',
  branch:
    'border-[color:var(--border-strong)] bg-[color:var(--bg-hover)] text-[color:var(--text-secondary)]',
};
const DOT: Record<FlowCategory, string> = {
  human: 'bg-[color:var(--accent)]',
  auto: 'bg-success-fg',
  suspend: 'bg-danger-fg',
  wait: 'bg-warning-fg',
  branch: 'bg-[color:var(--text-muted)]',
};
const CATEGORIES: FlowCategory[] = ['human', 'auto', 'suspend', 'wait', 'branch'];
const GRID: CSSProperties = {
  backgroundImage: 'radial-gradient(circle, var(--border-strong) 1px, transparent 1.2px)',
  backgroundSize: '16px 16px',
};

const key = (id: FlowNodeId, part: 'label' | 'sub' | 'text') =>
  `incidentFlow_${id}_${part}` as TranslationKey;

/** Width of an element, kept current with a ResizeObserver; null until known. */
function useWidth(ref: React.RefObject<HTMLElement | null>): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measured = el.clientWidth || el.getBoundingClientRect().width;
    if (measured > 0) setWidth(measured);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(w);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

function isNarrowViewport(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(`(max-width: ${WIDE_MIN_WIDTH - 1}px)`).matches
  );
}

interface IncidentFlowDiagramProps {
  /** The step to mark as the current one. */
  activeStep?: FlowNodeId | null;
}

export function IncidentFlowDiagram({ activeStep = null }: IncidentFlowDiagramProps) {
  const { t } = useI18n();
  const uid = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const width = useWidth(wrapRef);
  const [selected, setSelected] = useState<FlowNodeId | null>(null);
  const vertical = width !== null ? width < WIDE_MIN_WIDTH : isNarrowViewport();
  const layout = flowLayout(vertical, width ?? 0);
  const panelId = `${uid}-panel`;

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selected]);

  const nodeOf = (id: FlowNodeId) => FLOW_NODES.find((n) => n.id === id) as FlowNodeDef;
  const pillText = (p: FlowPill): string =>
    p === 'yes'
      ? t('incidentFlowYes')
      : p === 'no'
        ? t('incidentFlowNo')
        : p === 'level1'
          ? '1'
          : '2/3';
  const toggle = (id: FlowNodeId) => setSelected((cur) => (cur === id ? null : id));
  const edges = FLOW_EDGES.map((e) => ({ edge: e, geo: edgeGeometry(layout, e) }));
  const selectedNode = selected ? nodeOf(selected) : null;

  return (
    <div data-testid="incident-flow" className="space-y-2">
      <p className="text-sm text-[color:var(--text-secondary)]">{t('incidentFlowIntro')}</p>
      <div
        ref={wrapRef}
        className="overflow-x-auto rounded-card border border-[color:var(--border)] bg-[color:var(--bg-card)]"
        style={GRID}
      >
        <div
          role="group"
          aria-label={t('incidentFlowCanvasLabel')}
          data-layout={vertical ? 'vertical' : 'wide'}
          className="relative"
          style={{ width: layout.width, height: layout.height }}
        >
          <svg
            aria-hidden="true"
            width={layout.width}
            height={layout.height}
            className="pointer-events-none absolute inset-0 text-[color:var(--text-muted)]"
          >
            <defs>
              <marker
                id={`${uid}-arrow`}
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="7"
                markerHeight="7"
                orient="auto"
              >
                <path d="M 1 1 L 7 4 L 1 7" fill="none" stroke="currentColor" strokeWidth="1.5" />
              </marker>
            </defs>
            {edges.map(({ edge, geo }) => (
              <path
                key={`${edge.from}-${edge.to}`}
                data-edge={`${edge.from}-${edge.to}`}
                d={geo.d}
                fill="none"
                stroke="currentColor"
                strokeOpacity={0.6}
                strokeWidth={1.5}
                strokeDasharray={edge.dashed ? '5 4' : undefined}
                markerEnd={`url(#${uid}-arrow)`}
              />
            ))}
          </svg>

          {edges.map(({ edge, geo }) => (
            <span
              key={`dot-${edge.from}-${edge.to}`}
              aria-hidden="true"
              className="pointer-events-none absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[color:var(--text-muted)]"
              style={{ left: geo.start.x, top: geo.start.y }}
            />
          ))}
          {edges.map(({ edge, geo }) =>
            edge.pill ? (
              <span
                key={`pill-${edge.from}-${edge.to}`}
                data-pill={`${edge.from}-${edge.to}`}
                aria-hidden="true"
                className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-[color:var(--border)] bg-[color:var(--bg-card)] px-1.5 text-[10px] font-medium leading-4 text-[color:var(--text-secondary)]"
                style={{ left: geo.mid.x, top: geo.mid.y }}
              >
                {pillText(edge.pill)}
              </span>
            ) : null,
          )}

          {FLOW_NODES.map((node) => {
            const p = layout.pos[node.id];
            const size = node.small ? SMALL_NODE_SIZE : NODE_SIZE;
            const isCurrent = activeStep === node.id;
            const isOpen = selected === node.id;
            const label = t(key(node.id, 'label'));
            const sub = t(key(node.id, 'sub'));
            const labelStyle: CSSProperties = vertical
              ? {
                  left: p.x + size / 2 + 10,
                  top: p.y,
                  transform: 'translateY(-50%)',
                  width: layout.width - (p.x + size / 2 + 10) - 8,
                }
              : {
                  left: p.x - 52,
                  width: 104,
                  top: node.labelAbove ? p.y - size / 2 - 6 : p.y + size / 2 + 6,
                  transform: node.labelAbove ? 'translateY(-100%)' : undefined,
                };
            return (
              <div key={node.id} data-node={node.id}>
                <button
                  type="button"
                  aria-label={`${label}: ${sub}${isCurrent ? ` (${t('incidentFlowCurrent')})` : ''}`}
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  data-current={isCurrent ? 'true' : undefined}
                  onClick={() => toggle(node.id)}
                  className={`press-effect absolute flex items-center justify-center border shadow-sm transition-shadow hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-ring)] ${
                    TONE[node.category]
                  } ${node.trigger ? 'rounded-l-[28px] rounded-r-xl' : node.small ? 'rounded-xl' : 'rounded-2xl'} ${
                    isCurrent
                      ? 'ring-2 ring-[color:var(--accent)] ring-offset-2 ring-offset-[color:var(--bg-card)]'
                      : ''
                  } ${isOpen ? 'shadow-md' : ''}`}
                  style={{ left: p.x - size / 2, top: p.y - size / 2, width: size, height: size }}
                >
                  <Icon name={node.icon} size={node.small ? 20 : 26} />
                </button>
                <div
                  aria-hidden="true"
                  onClick={() => toggle(node.id)}
                  className={`absolute cursor-pointer rounded bg-[color:var(--bg-card)] px-1 leading-tight ${
                    vertical ? 'text-left' : 'text-center'
                  }`}
                  style={labelStyle}
                >
                  <div className="text-xs font-semibold text-[color:var(--text-primary)]">
                    {label}
                  </div>
                  <div className="text-[11px] text-[color:var(--text-muted)]">{sub}</div>
                  {isCurrent && (
                    <div className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-[color:var(--accent-surface)] px-1.5 text-[10px] font-semibold text-[color:var(--accent-on-surface)]">
                      <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--accent)]" />
                      {t('incidentFlowCurrent')}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <ul
        aria-label={t('incidentFlowLegendLabel')}
        className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[color:var(--text-secondary)]"
      >
        {CATEGORIES.map((c) => (
          <li key={c} className="inline-flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${DOT[c]}`} aria-hidden="true" />
            {t(`incidentFlowCat_${c}` as TranslationKey)}
          </li>
        ))}
      </ul>
      <p className="flex items-center gap-1.5 text-xs text-[color:var(--text-muted)]">
        <Icon name="link" size={14} className="shrink-0" />
        {t('incidentFlowNote')}
      </p>

      <div id={panelId} aria-live="polite">
        {selectedNode && (
          <section
            aria-label={t(key(selectedNode.id, 'label'))}
            data-testid="incident-flow-panel"
            className={`animate-fade-in rounded-card border p-3 text-sm ${TONE[selectedNode.category]}`}
          >
            <div className="flex items-start gap-2">
              <Icon name={selectedNode.icon} size={20} className="mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1 space-y-1">
                <h3 className="font-semibold text-[color:var(--text-primary)]">
                  {t(key(selectedNode.id, 'label'))}
                </h3>
                <p className="text-[color:var(--text-secondary)]">
                  {t(key(selectedNode.id, 'text'))}
                </p>
                <NextSteps from={selectedNode.id} pillText={pillText} />
              </div>
              <button
                type="button"
                aria-label={t('incidentFlowClose')}
                onClick={() => setSelected(null)}
                className="press-effect rounded-control p-1 text-[color:var(--text-secondary)] hover:bg-[color:var(--bg-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus-ring)]"
              >
                <Icon name="close" size={18} />
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

/** "Next: yes → Confirmed · no → False alarm". */
function NextSteps({ from, pillText }: { from: FlowNodeId; pillText: (p: FlowPill) => string }) {
  const { t } = useI18n();
  const next = FLOW_EDGES.filter((e) => e.from === from);
  if (next.length === 0) return null;
  return (
    <p className="text-xs text-[color:var(--text-muted)]">
      {t('incidentFlowThen')}:{' '}
      {next
        .map((e) => `${e.pill ? `${pillText(e.pill)} → ` : ''}${t(key(e.to, 'label'))}`)
        .join(' · ')}
    </p>
  );
}
