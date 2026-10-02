/**
 * RelationOverlay.test.tsx — the active relation is drawn as one aria-hidden
 * SVG Bézier from the FK source to the target row (or the target card when
 * the row is missing), with end markers and a ring around the target; it
 * re-measures on scroll and resize, draws a fresh line for a new relation,
 * fades out when the relation clears and is static under Reduce Motion.
 * Element boxes come from a getBoundingClientRect mock.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { useCanvasStore } from '../../../stores/canvas.store';
import { RelationOverlay } from '../RelationOverlay';

type Rect = { left: number; top: number; width: number; height: number };
let rects: Map<string, Rect>;

function rectKey(el: Element): string {
  if ((el as HTMLElement).dataset.testid === 'canvas') return 'canvas';
  return (el as HTMLElement).dataset.entityRow ?? el.id;
}

function Harness() {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} data-testid="canvas">
      <button id="fk-source" type="button">
        source
      </button>
      <section id="card-endpoints" style={{ borderRadius: '16px' }}>
        <div data-entity-row="endpoints:fhir.ukm.de" style={{ borderRadius: '10px' }} />
      </section>
      <RelationOverlay containerRef={ref} />
    </div>
  );
}

function show(targetKey?: string, sourceId = 'fk-source') {
  act(() =>
    useCanvasStore.getState().setActiveRelation({ sourceId, target: 'endpoints', targetKey }),
  );
}

const overlay = (c: HTMLElement) => c.querySelector<SVGSVGElement>('svg.relation-overlay');
const line = (c: HTMLElement) => c.querySelector<SVGPathElement>('path.relation-line');

beforeEach(() => {
  rects = new Map([
    ['canvas', { left: 0, top: 0, width: 1000, height: 800 }],
    ['fk-source', { left: 20, top: 40, width: 200, height: 32 }],
    ['card-endpoints', { left: 380, top: 20, width: 300, height: 300 }],
    ['endpoints:fhir.ukm.de', { left: 400, top: 100, width: 260, height: 48 }],
  ]);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const { left, top, width, height } = rects.get(rectKey(this)) ?? {
      left: 0,
      top: 0,
      width: 0,
      height: 0,
    };
    return {
      x: left,
      y: top,
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      toJSON: () => ({}),
    } as DOMRect;
  });
});

afterEach(() => {
  act(() => useCanvasStore.getState().setActiveRelation(null));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('RelationOverlay', () => {
  it('draws nothing without an active relation', () => {
    const { container } = renderWithProviders(<Harness />);
    expect(overlay(container)).toBeNull();
  });

  it('draws one aria-hidden Bézier from the source to the target row', () => {
    const { container } = renderWithProviders(<Harness />);
    show('fhir.ukm.de');

    const svg = overlay(container)!;
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('data-state', 'open');
    // Source right edge (220, 56) to row left edge (400, 124), horizontal tangents.
    expect(line(container)).toHaveAttribute('d', 'M220 56 C310 56 310 124 400 124');
    expect(container.querySelectorAll('path.relation-line')).toHaveLength(1);

    const [start, end] = Array.from(container.querySelectorAll('circle.relation-end'));
    expect([start.getAttribute('cx'), start.getAttribute('cy')]).toEqual(['220', '56']);
    expect([end.getAttribute('cx'), end.getAttribute('cy')]).toEqual(['400', '124']);

    const ring = container.querySelector('rect.relation-target-ring')!;
    expect(ring.getAttribute('x')).toBe('397');
    expect(ring.getAttribute('width')).toBe('266');
    expect(ring.getAttribute('rx')).toBe('13');
  });

  it('points at the target card when the row is not rendered', () => {
    const { container } = renderWithProviders(<Harness />);
    show('gone.ukm.de');
    // Card left edge (380, 170).
    expect(line(container)).toHaveAttribute('d', 'M220 56 C300 56 300 170 380 170');
  });

  it('draws nothing when the source is not in the canvas', () => {
    const { container } = renderWithProviders(<Harness />);
    show('fhir.ukm.de', 'fk-missing');
    expect(overlay(container)).toBeNull();
  });

  it('follows scrolling and resizing', async () => {
    const { container, getByTestId } = renderWithProviders(<Harness />);
    show('fhir.ukm.de');
    const canvas = getByTestId('canvas');

    // Scrolled by 30px: everything moves up in the viewport, content
    // coordinates stay put.
    rects.set('fk-source', { left: 20, top: 10, width: 200, height: 32 });
    rects.set('endpoints:fhir.ukm.de', { left: 400, top: 70, width: 260, height: 48 });
    Object.defineProperty(canvas, 'scrollTop', { configurable: true, value: 30 });
    fireEvent.scroll(canvas);
    await waitFor(() =>
      expect(line(container)).toHaveAttribute('d', 'M220 56 C310 56 310 124 400 124'),
    );

    // A resize that moves the row is picked up too.
    rects.set('endpoints:fhir.ukm.de', { left: 500, top: 70, width: 260, height: 48 });
    fireEvent(window, new Event('resize'));
    await waitFor(() =>
      expect(line(container)).toHaveAttribute('d', 'M220 56 C360 56 360 124 500 124'),
    );
  });

  it('draws a fresh line for a new relation', () => {
    const { container } = renderWithProviders(<Harness />);
    show('fhir.ukm.de');
    const first = line(container);
    show();
    const second = line(container);
    expect(second).not.toBe(first);
    expect(second).toHaveAttribute('d', 'M220 56 C300 56 300 170 380 170');
  });

  it('fades out when the relation clears, then unmounts', async () => {
    const { container } = renderWithProviders(<Harness />);
    show('fhir.ukm.de');
    act(() => useCanvasStore.getState().setActiveRelation(null));
    expect(overlay(container)).toHaveAttribute('data-state', 'closed');
    await waitFor(() => expect(overlay(container)).toBeNull());
  });

  it('is static under Reduce Motion: clearing removes the line at once', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
    const { container } = renderWithProviders(<Harness />);
    show('fhir.ukm.de');
    expect(overlay(container)).not.toBeNull();
    act(() => useCanvasStore.getState().setActiveRelation(null));
    expect(overlay(container)).toBeNull();
  });
});
