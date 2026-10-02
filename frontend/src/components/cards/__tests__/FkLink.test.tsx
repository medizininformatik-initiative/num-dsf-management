/**
 * FkLink.test.tsx — the FK link is a keyboard-reachable button named after its
 * label, value and target; hover and focus publish the relation line, and
 * activating it highlights the target card or row, moves focus to the target
 * card and scrolls the target into view (instantly under Reduce Motion).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { useCanvasStore } from '../../../stores/canvas.store';
import { FkLink } from '../FkLink';

const NAME = 'Organization: ukm.de. Jump to the Organization card';

afterEach(() => {
  useCanvasStore.getState().highlightEntity(null);
  useCanvasStore.getState().setActiveRelation(null);
  vi.unstubAllGlobals();
});

describe('FkLink', () => {
  it('renders the label and value as one button with a descriptive name', () => {
    renderWithProviders(<FkLink label="Organization" targetEntity="organization" value="ukm.de" />);
    const button = screen.getByRole('button', { name: NAME });
    expect(button).toHaveTextContent('Organization');
    expect(button).toHaveTextContent('ukm.de');
  });

  it('names the target in German', () => {
    renderWithProviders(
      <FkLink label="Organisation" targetEntity="organization" value="ukm.de" />,
      { lang: 'de' },
    );
    expect(
      screen.getByRole('button', {
        name: 'Organisation: ukm.de. Zur Karte Organisation springen',
      }),
    ).toBeInTheDocument();
  });

  it('highlights the target entity when the value is clicked', async () => {
    renderWithProviders(<FkLink label="Endpoint" targetEntity="endpoints" value="ep.ukm.de" />);
    await userEvent.click(screen.getByText('ep.ukm.de'));
    expect(useCanvasStore.getState().highlightedEntity).toBe('endpoints');
  });

  it('is a tab stop and draws its relation while focused', async () => {
    renderWithProviders(<FkLink label="Organization" targetEntity="organization" value="ukm.de" />);
    const button = screen.getByRole('button', { name: NAME });
    await userEvent.tab();
    expect(button).toHaveFocus();
    expect(useCanvasStore.getState().activeRelation).toEqual({
      sourceId: button.id,
      target: 'organization',
      targetKey: undefined,
    });
    await userEvent.tab();
    expect(useCanvasStore.getState().activeRelation).toBeNull();
  });

  it('draws its relation while a mouse hovers it, but not for a touch tap', async () => {
    renderWithProviders(<FkLink label="Organization" targetEntity="organization" value="ukm.de" />);
    const button = screen.getByRole('button', { name: NAME });
    await userEvent.hover(button);
    expect(useCanvasStore.getState().activeRelation?.sourceId).toBe(button.id);
    await userEvent.unhover(button);
    expect(useCanvasStore.getState().activeRelation).toBeNull();

    // jsdom has no PointerEvent, so give a plain event the touch pointer type.
    const tap = new MouseEvent('pointerover', { bubbles: true });
    Object.defineProperty(tap, 'pointerType', { value: 'touch' });
    fireEvent(button, tap);
    expect(useCanvasStore.getState().activeRelation).toBeNull();
  });

  it('keeps the line of a focused link when the pointer leaves it', async () => {
    renderWithProviders(<FkLink label="Organization" targetEntity="organization" value="ukm.de" />);
    const button = screen.getByRole('button', { name: NAME });
    await userEvent.tab();
    await userEvent.hover(button);
    await userEvent.unhover(button);
    expect(useCanvasStore.getState().activeRelation?.sourceId).toBe(button.id);
  });

  it('clears its relation when it unmounts', async () => {
    const { unmount } = renderWithProviders(
      <FkLink label="Organization" targetEntity="organization" value="ukm.de" />,
    );
    await userEvent.tab();
    expect(useCanvasStore.getState().activeRelation).not.toBeNull();
    unmount();
    expect(useCanvasStore.getState().activeRelation).toBeNull();
  });

  it('moves focus to the target card like an in-page link', async () => {
    renderWithProviders(
      <>
        <section id="card-organization" tabIndex={-1} aria-label="Organization card" />
        <FkLink label="Organization" targetEntity="organization" value="ukm.de" />
      </>,
    );
    await userEvent.click(screen.getByRole('button', { name: NAME }));
    expect(screen.getByRole('region', { name: 'Organization card' })).toHaveFocus();
  });
});

describe('FkLink row targets', () => {
  it('highlights the target row when a key is given', async () => {
    renderWithProviders(
      <FkLink label="Endpoint" targetEntity="endpoints" value="ep.ukm.de" targetKey="ep.ukm.de" />,
    );
    await userEvent.click(screen.getByText('ep.ukm.de'));
    expect(useCanvasStore.getState().highlightedEntity).toBe('endpoints');
    expect(useCanvasStore.getState().highlightedKey).toBe('ep.ukm.de');
  });

  it('scrolls the target row into view, smoothly by default', async () => {
    renderWithProviders(
      <>
        <div data-entity-row="endpoints:ep.ukm.de" />
        <FkLink label="Endpoint" targetEntity="endpoints" value="ep.ukm.de" targetKey="ep.ukm.de" />
      </>,
    );
    const row = document.querySelector<HTMLElement>('[data-entity-row]')!;
    row.scrollIntoView = vi.fn();
    await userEvent.click(screen.getByText('ep.ukm.de'));
    expect(row.scrollIntoView).toHaveBeenCalledWith({
      block: 'nearest',
      inline: 'nearest',
      behavior: 'smooth',
    });
  });

  it('scrolls instantly under Reduce Motion', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn() }),
    );
    renderWithProviders(
      <>
        <div data-entity-row="endpoints:ep.ukm.de" />
        <FkLink label="Endpoint" targetEntity="endpoints" value="ep.ukm.de" targetKey="ep.ukm.de" />
      </>,
    );
    const row = document.querySelector<HTMLElement>('[data-entity-row]')!;
    row.scrollIntoView = vi.fn();
    await userEvent.click(screen.getByText('ep.ukm.de'));
    expect(row.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }));
  });
});
