/**
 * EntityCanvas.layout.test.tsx — the canvas lays its cards out in one CSS grid
 * whose columns come from the canvas width (entity-canvas.css), not from
 * window.innerWidth: every card renders once, in reading order, after the
 * onboarding wizard; a window resize neither re-parents nor remounts a card;
 * each cell carries its stagger index and Organization spans two rows. Each
 * child card and the wizard are stubbed so the assertions stay on the
 * canvas's own structure.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';

// Stub every child so the test exercises only EntityCanvas's layout, not the
// cards' own data hooks. Each stub echoes its instanceId so we can prove the
// prop is threaded through.
vi.mock('../OnboardingWizard', () => ({
  OnboardingWizard: ({ instanceId }: { instanceId: string }) => (
    <div data-testid="onboarding-wizard">wizard:{instanceId}</div>
  ),
}));
vi.mock('../../cards/OrganizationCard', () => ({
  OrganizationCard: ({ instanceId }: { instanceId: string }) => (
    <div data-testid="organization-card">org:{instanceId}</div>
  ),
}));
vi.mock('../../cards/ContactsCard', () => ({
  ContactsCard: ({ instanceId }: { instanceId: string }) => (
    <div data-testid="contacts-card">contacts:{instanceId}</div>
  ),
}));
vi.mock('../../cards/EndpointsCard', () => ({
  EndpointsCard: ({ instanceId }: { instanceId: string }) => (
    <div data-testid="endpoints-card">endpoints:{instanceId}</div>
  ),
}));
vi.mock('../../cards/CertificatesCard', () => ({
  CertificatesCard: ({ instanceId }: { instanceId: string }) => (
    <div data-testid="certificates-card">certificates:{instanceId}</div>
  ),
}));
vi.mock('../../cards/MembershipsCard', () => ({
  MembershipsCard: ({ instanceId }: { instanceId: string }) => (
    <div data-testid="memberships-card">memberships:{instanceId}</div>
  ),
}));

import { EntityCanvas } from '../EntityCanvas';

const CARD_TESTIDS = [
  'organization-card',
  'contacts-card',
  'endpoints-card',
  'memberships-card',
  'certificates-card',
] as const;

function setInnerWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
}

const originalInnerWidth = window.innerWidth;

afterEach(() => {
  setInnerWidth(originalInnerWidth);
  vi.clearAllMocks();
});

describe('EntityCanvas layout', () => {
  it('renders the wizard first, then all five cards once, in reading order, in one grid', () => {
    const { container } = renderWithProviders(<EntityCanvas instanceId="i1" />);
    const grid = container.querySelector('.entity-canvas-grid');
    expect(grid).not.toBeNull();
    const order = Array.from(grid!.querySelectorAll('[data-testid]')).map((el) =>
      el.getAttribute('data-testid'),
    );
    expect(order).toEqual([...CARD_TESTIDS]);
    // The wizard stays on top, outside the card grid.
    const wizard = screen.getByTestId('onboarding-wizard');
    expect(grid!.contains(wizard)).toBe(false);
    expect(wizard.compareDocumentPosition(grid!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('threads instanceId down to the wizard and every card', () => {
    renderWithProviders(<EntityCanvas instanceId="abc-123" />);
    expect(screen.getByTestId('onboarding-wizard')).toHaveTextContent('wizard:abc-123');
    expect(screen.getByTestId('organization-card')).toHaveTextContent('org:abc-123');
    expect(screen.getByTestId('contacts-card')).toHaveTextContent('contacts:abc-123');
    expect(screen.getByTestId('endpoints-card')).toHaveTextContent('endpoints:abc-123');
    expect(screen.getByTestId('certificates-card')).toHaveTextContent('certificates:abc-123');
    expect(screen.getByTestId('memberships-card')).toHaveTextContent('memberships:abc-123');
  });

  it('does not derive its columns from the window: a resize keeps every card mounted in place', () => {
    setInnerWidth(1600);
    const { container } = renderWithProviders(<EntityCanvas instanceId="i1" />);
    const before = CARD_TESTIDS.map((id) => screen.getByTestId(id));
    const grid = container.querySelector('.entity-canvas-grid');

    setInnerWidth(700);
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });

    // Same nodes in the same grid: nothing was re-parented or remounted, so
    // card state (e.g. an inline edit) survives panels opening and closing.
    CARD_TESTIDS.forEach((id, i) => expect(screen.getByTestId(id)).toBe(before[i]));
    expect(container.querySelector('.entity-canvas-grid')).toBe(grid);
    expect(container.querySelector('[style*="grid-template-columns"]')).toBeNull();
  });

  it('staggers the entrance by card index and lets Organization span two rows', () => {
    const { container } = renderWithProviders(<EntityCanvas instanceId="i1" />);
    const cells = Array.from(container.querySelectorAll<HTMLElement>('.entity-canvas-cell'));
    expect(cells).toHaveLength(5);
    cells.forEach((cell, i) => {
      expect(cell).toHaveClass('animate-list-item-in');
      expect(cell.style.getPropertyValue('--stagger-index')).toBe(String(i));
    });
    expect(cells[0]).toHaveAttribute('data-canvas-cell', 'organization');
    expect(cells[0]).toHaveClass('entity-canvas-cell--lead');
    expect(cells.slice(1).some((c) => c.classList.contains('entity-canvas-cell--lead'))).toBe(
      false,
    );
  });
});
