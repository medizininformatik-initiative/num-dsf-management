/**
 * incidentFlow.ts – the model of the incident-process diagram: the steps
 * (nodes) with their category and icon, the connections (edges), the layout
 * as plain coordinates for the wide (left to right) and the narrow (top to
 * bottom) variant, the Bézier path of every edge derived from those
 * coordinates, and the step a given incident is currently in. Pure: no DOM
 * measuring, no React.
 * Dependencies: api/incidents.api (IncidentStatus type only).
 */
import type { IncidentStatus } from '../api/incidents.api';

export type FlowNodeId =
  | 'report'
  | 'assess'
  | 'decision'
  | 'falseAlarm'
  | 'confirmed'
  | 'escalation'
  | 'monitoring'
  | 'suspend'
  | 'deadlines'
  | 'restart';

/** human step, automatic action, suspension, wait/deadline, branch or outside the portal. */
export type FlowCategory = 'human' | 'auto' | 'suspend' | 'wait' | 'branch';

export interface FlowNodeDef {
  id: FlowNodeId;
  icon: string;
  category: FlowCategory;
  /** Trigger node: rounded on its left side only. */
  trigger?: boolean;
  /** Small end node (40 px instead of 56 px). */
  small?: boolean;
  /** Label above the node, for nodes with an edge leaving downwards. */
  labelAbove?: boolean;
}

/** In reading order, which is also the keyboard and screen-reader order. */
export const FLOW_NODES: FlowNodeDef[] = [
  { id: 'report', icon: 'flag', category: 'human', trigger: true },
  { id: 'assess', icon: 'fact_check', category: 'human' },
  { id: 'decision', icon: 'call_split', category: 'branch', labelAbove: true },
  { id: 'falseAlarm', icon: 'do_not_disturb_on', category: 'branch', small: true },
  { id: 'confirmed', icon: 'campaign', category: 'auto' },
  { id: 'escalation', icon: 'alt_route', category: 'branch' },
  { id: 'suspend', icon: 'block', category: 'suspend' },
  { id: 'monitoring', icon: 'monitoring', category: 'branch', small: true },
  { id: 'deadlines', icon: 'timer', category: 'wait' },
  { id: 'restart', icon: 'lock_open', category: 'human' },
];

export type FlowPill = 'yes' | 'no' | 'level1' | 'level23';

export interface FlowEdgeDef {
  from: FlowNodeId;
  to: FlowNodeId;
  pill?: FlowPill;
  /** The optional path. */
  dashed?: boolean;
}

export const FLOW_EDGES: FlowEdgeDef[] = [
  { from: 'report', to: 'assess' },
  { from: 'assess', to: 'decision' },
  { from: 'decision', to: 'confirmed', pill: 'yes' },
  { from: 'decision', to: 'falseAlarm', pill: 'no' },
  { from: 'confirmed', to: 'escalation' },
  { from: 'escalation', to: 'suspend', pill: 'level23' },
  { from: 'escalation', to: 'monitoring', pill: 'level1' },
  { from: 'suspend', to: 'deadlines' },
  { from: 'monitoring', to: 'deadlines', dashed: true },
  { from: 'deadlines', to: 'restart' },
];

export interface Point {
  x: number;
  y: number;
}

export interface FlowLayout {
  vertical: boolean;
  width: number;
  height: number;
  pos: Record<FlowNodeId, Point>;
}

export const NODE_SIZE = 56;
export const SMALL_NODE_SIZE = 40;
/** Below this container width the diagram runs top to bottom. */
export const WIDE_MIN_WIDTH = 720;

const half = (id: FlowNodeId): number =>
  (FLOW_NODES.find((n) => n.id === id)?.small ? SMALL_NODE_SIZE : NODE_SIZE) / 2;

/** Wide: one band left to right, suspension above and monitoring below the main line. */
const WIDE: Record<FlowNodeId, Point> = {
  report: { x: 70, y: 120 },
  assess: { x: 200, y: 120 },
  decision: { x: 330, y: 120 },
  falseAlarm: { x: 330, y: 205 },
  confirmed: { x: 460, y: 120 },
  escalation: { x: 590, y: 120 },
  suspend: { x: 730, y: 60 },
  monitoring: { x: 730, y: 205 },
  deadlines: { x: 870, y: 120 },
  restart: { x: 1010, y: 120 },
};

/** Narrow: a main lane with the end/optional nodes in a second lane beside it. */
const NARROW_MAIN = 36;
const NARROW_SIDE = 110;
const NARROW: Record<FlowNodeId, Point> = {
  report: { x: NARROW_MAIN, y: 40 },
  assess: { x: NARROW_MAIN, y: 132 },
  decision: { x: NARROW_MAIN, y: 224 },
  falseAlarm: { x: NARROW_SIDE, y: 300 },
  confirmed: { x: NARROW_MAIN, y: 380 },
  escalation: { x: NARROW_MAIN, y: 472 },
  monitoring: { x: NARROW_SIDE, y: 548 },
  suspend: { x: NARROW_MAIN, y: 628 },
  deadlines: { x: NARROW_MAIN, y: 720 },
  restart: { x: NARROW_MAIN, y: 812 },
};

/** `width` is the available width; only the narrow variant uses it (for label widths). */
export function flowLayout(vertical: boolean, width = 0): FlowLayout {
  if (vertical) {
    return { vertical, width: Math.max(width, 300), height: 880, pos: NARROW };
  }
  return { vertical, width: 1090, height: 270, pos: WIDE };
}

export interface EdgeGeometry {
  d: string;
  start: Point;
  end: Point;
  mid: Point;
}

/** Point of a cubic Bézier at t. */
function cubicAt(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const f = (a: number, b: number, c: number, d: number) =>
    u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
  return { x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) };
}

/**
 * Smooth cubic path between the ports of two nodes. Wide: out of the right
 * side into the left side (the reverse when it runs backwards, straight down
 * or up when both are in one column). Narrow: bottom into top.
 */
export function edgeGeometry(layout: FlowLayout, edge: FlowEdgeDef): EdgeGeometry {
  const a = layout.pos[edge.from];
  const b = layout.pos[edge.to];
  const ha = half(edge.from);
  const hb = half(edge.to);
  let start: Point;
  let end: Point;
  let c1: Point;
  let c2: Point;
  if (!layout.vertical && Math.abs(b.x - a.x) > 1) {
    const dir = b.x > a.x ? 1 : -1;
    start = { x: a.x + dir * ha, y: a.y };
    end = { x: b.x - dir * hb, y: b.y };
    const d = Math.max(40, Math.abs(end.x - start.x) / 2);
    c1 = { x: start.x + dir * d, y: start.y };
    c2 = { x: end.x - dir * d, y: end.y };
  } else {
    const dir = b.y >= a.y ? 1 : -1;
    start = { x: a.x, y: a.y + dir * ha };
    end = { x: b.x, y: b.y - dir * hb };
    const d = Math.max(20, Math.abs(end.y - start.y) / 2);
    c1 = { x: start.x, y: start.y + dir * d };
    c2 = { x: end.x, y: end.y - dir * d };
  }
  const f = (n: number) => Math.round(n * 10) / 10;
  return {
    d: `M ${f(start.x)} ${f(start.y)} C ${f(c1.x)} ${f(c1.y)}, ${f(c2.x)} ${f(c2.y)}, ${f(end.x)} ${f(end.y)}`,
    start,
    end,
    mid: cubicAt(start, c1, c2, end, 0.55),
  };
}

/** The step of the process an incident is in, for the highlight. */
export function currentFlowStep(
  status: IncidentStatus,
  suspended: boolean,
  suspensionLifted: boolean,
): FlowNodeId {
  if (status === 'REPORTED') return 'assess';
  if (status === 'FALSE_ALARM') return 'falseAlarm';
  if (status === 'CLOSED') return 'restart';
  if (suspended) return 'suspend';
  return suspensionLifted ? 'restart' : 'confirmed';
}
