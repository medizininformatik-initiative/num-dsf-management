/**
 * EntityCanvas.lines.test.tsx — the relation lines end to end: a real FkLink
 * inside a card draws its relation line to the target card while hovered or
 * focused, removes it on leave or blur, and activating it rings the target
 * and moves focus there. Cards are stubbed around the real FkLink; element
 * boxes come from a getBoundingClientRect mock.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { useCanvasStore } from '../../../stores/canvas.store';

vi.mock('../OnboardingWizard', () => ({ OnboardingWizard: () => null }));
vi.mock('../../cards/OrganizationCard', () => ({
  OrganizationCard: () => (
    <section id="card-organization" tabIndex={-1} aria-label="Organization">
      org
    </section>
  ),
}));
vi.mock('../../cards/ContactsCard', async () => {
  const { FkLink } = await import('../../cards/FkLink');
  return {
    ContactsCard: () => (
      <section id="card-contacts">
        <FkLink label="Organization" targetEntity="organization" value="ukm.de" />
      </section>
    ),
  };
});
vi.mock('../../cards/EndpointsCard', () => ({ EndpointsCard: () => null }));
vi.mock('../../cards/MembershipsCard', () => ({ MembershipsCard: () => null }));
vi.mock('../../cards/CertificatesCard', () => ({ CertificatesCard: () => null }));

import { EntityCanvas } from '../EntityCanvas';

const FK_NAME = 'Organization: ukm.de. Jump to the Organization card';

beforeEach(() => {
  // Organization on the left, the contacts FK link to its right.
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const box =
      this.id === 'card-organization'
        ? { left: 16, top: 16, width: 300, height: 400 }
        : this.tagName === 'BUTTON'
          ? { left: 352, top: 80, width: 280, height: 32 }
          : { left: 0, top: 0, width: 0, height: 0 };
    return {
      ...box,
      x: box.left,
      y: box.top,
      right: box.left + box.width,
      bottom: box.top + box.height,
      toJSON: () => ({}),
    } as DOMRect;
  });
});

afterEach(() => {
  act(() => {
    useCanvasStore.getState().setActiveRelation(null);
    useCanvasStore.getState().highlightEntity(null);
  });
  vi.restoreAllMocks();
});

const line = (c: HTMLElement) => c.querySelector('svg.relation-overlay path.relation-line');

describe('EntityCanvas relation lines', () => {
  it('draws the line from a hovered FK link to its target card and removes it on leave', async () => {
    const { container } = renderWithProviders(<EntityCanvas instanceId="i1" />);
    expect(line(container)).toBeNull();

    const fk = screen.getByRole('button', { name: FK_NAME });
    await userEvent.hover(fk);
    // From the link's left edge (352, 96) to the card's right edge (316, 216).
    expect(line(container)).toHaveAttribute('d', 'M352 96 C328 96 340 216 316 216');

    await userEvent.unhover(fk);
    await waitFor(() => expect(line(container)).toBeNull());
  });

  it('draws the line while the FK link has keyboard focus', async () => {
    const { container } = renderWithProviders(<EntityCanvas instanceId="i1" />);
    await userEvent.tab();
    expect(screen.getByRole('button', { name: FK_NAME })).toHaveFocus();
    expect(line(container)).not.toBeNull();
  });

  it('rings the target and moves focus to it when the FK link is activated', async () => {
    const { container } = renderWithProviders(<EntityCanvas instanceId="i1" />);
    await userEvent.click(screen.getByRole('button', { name: FK_NAME }));

    expect(screen.getByRole('region', { name: 'Organization' })).toHaveFocus();
    const ring = container.querySelector<HTMLElement>('.fk-ring')!;
    expect(ring.style.left).toBe('16px');
    expect(ring.style.height).toBe('400px');
    // Focus left the FK link, so its line gives way to the ring.
    await waitFor(() => expect(line(container)).toBeNull());
  });
});
