/**
 * EntityCanvas.highlight.test.tsx — the FK-jump highlight. When the canvas
 * store highlights an entity, the canvas draws one ring overlay over the
 * target row (when the highlight names a rendered row) or over the target
 * card, matching its box and corner radius, without touching the target's own
 * DOM. The ring replays its pulse when the same target is highlighted again,
 * follows the target on scroll, fades out when the highlight clears and is
 * static under Reduce Motion. The cards are stubbed with known DOM; element
 * boxes come from a getBoundingClientRect mock.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { useCanvasStore } from '../../../stores/canvas.store';

vi.mock('../OnboardingWizard', () => ({ OnboardingWizard: () => null }));
vi.mock('../../cards/OrganizationCard', () => ({
  OrganizationCard: () => (
    <section id="card-organization" style={{ borderRadius: '16px' }}>
      org
    </section>
  ),
}));
vi.mock('../../cards/ContactsCard', () => ({
  ContactsCard: () => <section id="card-contacts">contacts</section>,
}));
vi.mock('../../cards/EndpointsCard', () => ({
  EndpointsCard: () => (
    <section id="card-endpoints" style={{ borderRadius: '16px' }}>
      <div data-entity-row="endpoints:fhir.ukm.de" style={{ borderRadius: '10px' }}>
        fhir.ukm.de
      </div>
    </section>
  ),
}));
vi.mock('../../cards/MembershipsCard', () => ({
  MembershipsCard: () => <section id="card-memberships">memberships</section>,
}));
vi.mock('../../cards/CertificatesCard', () => ({
  CertificatesCard: () => <section id="card-certificates">certificates</section>,
}));

import { EntityCanvas } from '../EntityCanvas';

type Rect = { left: number; top: number; width: number; height: number };

// Viewport boxes by element; the canvas sits at the viewport origin.
let rects: Map<string, Rect>;

function rectKey(el: Element): string {
  if (el.classList.contains('entity-canvas')) return 'canvas';
  return (el as HTMLElement).dataset.entityRow ?? el.id;
}

function domRect({ left, top, width, height }: Rect): DOMRect {
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
}

function ring(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('.fk-ring');
}

function stubReducedMotion() {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
}

beforeEach(() => {
  rects = new Map([
    ['canvas', { left: 0, top: 0, width: 1000, height: 800 }],
    ['card-organization', { left: 16, top: 16, width: 300, height: 400 }],
    ['card-endpoints', { left: 332, top: 16, width: 300, height: 200 }],
    ['endpoints:fhir.ukm.de', { left: 352, top: 80, width: 260, height: 48 }],
  ]);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return domRect(rects.get(rectKey(this)) ?? { left: 0, top: 0, width: 0, height: 0 });
  });
});

afterEach(() => {
  act(() => useCanvasStore.getState().highlightEntity(null));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('EntityCanvas highlight ring', () => {
  it('draws no ring until something is highlighted', () => {
    const { container } = renderWithProviders(<EntityCanvas instanceId="i1" />);
    expect(ring(container)).toBeNull();
  });

  it('rings the highlighted card, matching its box and radius', () => {
    const { container } = renderWithProviders(<EntityCanvas instanceId="i1" />);
    act(() => useCanvasStore.getState().highlightEntity('organization'));

    const el = ring(container)!;
    expect(el).toHaveAttribute('aria-hidden', 'true');
    expect(el).toHaveAttribute('data-state', 'open');
    expect(el.style.left).toBe('16px');
    expect(el.style.top).toBe('16px');
    expect(el.style.width).toBe('300px');
    expect(el.style.height).toBe('400px');
    expect(el.style.borderRadius).toBe('16px');
    expect(container.querySelectorAll('.fk-ring')).toHaveLength(1);
  });

  it('rings the target row when the highlight names one', () => {
    const { container } = renderWithProviders(<EntityCanvas instanceId="i1" />);
    act(() => useCanvasStore.getState().highlightEntity('endpoints', 'fhir.ukm.de'));

    const el = ring(container)!;
    expect(el.style.left).toBe('352px');
    expect(el.style.top).toBe('80px');
    expect(el.style.width).toBe('260px');
    expect(el.style.borderRadius).toBe('10px');
  });

  it('falls back to the card when the named row is not rendered', () => {
    const { container } = renderWithProviders(<EntityCanvas instanceId="i1" />);
    act(() => useCanvasStore.getState().highlightEntity('endpoints', 'gone.ukm.de'));

    const el = ring(container)!;
    expect(el.style.left).toBe('332px');
    expect(el.style.height).toBe('200px');
  });

  it('leaves the target element itself untouched', () => {
    const { container } = renderWithProviders(<EntityCanvas instanceId="i1" />);
    const card = container.querySelector<HTMLElement>('#card-organization')!;
    const before = card.outerHTML;
    act(() => useCanvasStore.getState().highlightEntity('organization'));
    expect(card.outerHTML).toBe(before);
  });

  it('replays the pulse when the same target is highlighted again', () => {
    const { container } = renderWithProviders(<EntityCanvas instanceId="i1" />);
    act(() => useCanvasStore.getState().highlightEntity('organization'));
    const first = ring(container);
    act(() => useCanvasStore.getState().highlightEntity('organization'));
    const second = ring(container);
    expect(second).not.toBeNull();
    // A fresh element restarts its entry animation.
    expect(second).not.toBe(first);
  });

  it('follows the target when the canvas scrolls', async () => {
    const { container } = renderWithProviders(<EntityCanvas instanceId="i1" />);
    act(() => useCanvasStore.getState().highlightEntity('organization'));
    const canvas = container.querySelector<HTMLElement>('.entity-canvas')!;

    // Scrolling by 120px moves the card up in the viewport; content
    // coordinates (where the ring lives) stay the same.
    rects.set('card-organization', { left: 16, top: -104, width: 300, height: 400 });
    Object.defineProperty(canvas, 'scrollTop', { configurable: true, value: 120 });
    fireEvent.scroll(canvas);
    await waitFor(() => expect(ring(container)!.style.top).toBe('16px'));

    // A layout change that moves the card is picked up on the next frame.
    rects.set('card-organization', { left: 16, top: -64, width: 300, height: 400 });
    fireEvent.scroll(canvas);
    await waitFor(() => expect(ring(container)!.style.top).toBe('56px'));
  });

  it('fades out when the highlight clears, then unmounts', async () => {
    const { container } = renderWithProviders(<EntityCanvas instanceId="i1" />);
    act(() => useCanvasStore.getState().highlightEntity('organization'));
    act(() => useCanvasStore.getState().highlightEntity(null));

    expect(ring(container)).toHaveAttribute('data-state', 'closed');
    await waitFor(() => expect(ring(container)).toBeNull());
  });

  it('is static under Reduce Motion: clearing removes the ring at once', () => {
    stubReducedMotion();
    const { container } = renderWithProviders(<EntityCanvas instanceId="i1" />);
    act(() => useCanvasStore.getState().highlightEntity('organization'));
    expect(ring(container)).not.toBeNull();
    act(() => useCanvasStore.getState().highlightEntity(null));
    expect(ring(container)).toBeNull();
  });
});
