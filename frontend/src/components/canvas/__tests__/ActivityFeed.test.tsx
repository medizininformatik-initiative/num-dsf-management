/**
 * ActivityFeed.test.tsx — the "Recent activity" button and its popover, with
 * the data source (entities.api) mocked. With no active instance the query is
 * disabled, so expanding shows the empty state; with one, the audit entries
 * render with translated resource/operation labels and relative times. Also
 * covers the disclosure semantics, the origin-aware popover and Escape.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { useCanvasStore } from '../../../stores/canvas.store';

const getAuditLog = vi.fn();
vi.mock('../../../api/entities.api', () => ({
  api: () => ({ getAuditLog }),
}));

import { ActivityFeed } from '../ActivityFeed';

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

describe('ActivityFeed', () => {
  beforeEach(() => {
    getAuditLog.mockReset();
    getAuditLog.mockResolvedValue({ data: { data: [] } });
    useCanvasStore.setState({ activeInstanceId: null });
  });

  it('shows the empty state when expanded with no entries', () => {
    renderWithProviders(<ActivityFeed />);
    // The toggle button is the only button; clicking it expands the panel.
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText(/no activity yet/i)).toBeInTheDocument();
  });

  it('is a labelled disclosure button that controls an origin-aware popover', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ActivityFeed />);
    const trigger = screen.getByRole('button', { name: 'Recent activity' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await user.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const panel = screen.getByRole('region', { name: 'Recent activity' });
    expect(trigger).toHaveAttribute('aria-controls', panel.id);
    expect(panel.className).toContain('origin-bottom-right');
    expect(panel.className).toContain('data-[state=open]:animate-popover-in');
    expect(panel).toHaveFocus();
  });

  it('renders audit entries with translated labels and relative times', async () => {
    useCanvasStore.setState({ activeInstanceId: 'inst-1' });
    getAuditLog.mockResolvedValue({
      data: {
        data: [
          { id: 'a1', timestamp: minutesAgo(5), operation: 'CREATE', resource_type: 'CONTACT' },
          { id: 'a2', timestamp: minutesAgo(90), operation: 'DELETE', resource_type: 'ENDPOINT' },
          { id: 'a3', timestamp: minutesAgo(1), operation: 'SOMETHING_NEW', resource_type: 'X' },
        ],
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<ActivityFeed />, { lang: 'de' });

    await user.click(screen.getByRole('button', { name: 'Letzte Aktivitäten' }));

    const items = await screen.findAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Kontakt erstellt');
    expect(items[0]).toHaveTextContent('vor 5m');
    expect(items[1]).toHaveTextContent('Endpunkt gelöscht');
    expect(items[1]).toHaveTextContent('vor 1h');
    // Values the client does not know yet fall back to the raw enum.
    expect(items[2]).toHaveTextContent('X SOMETHING_NEW');
    expect(screen.getByText('3 Einträge')).toBeInTheDocument();
    expect(getAuditLog).toHaveBeenCalledWith('limit=8&page=1');
  });

  it('closes on Escape and returns focus to the button', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ActivityFeed />);
    const trigger = screen.getByRole('button', { name: 'Recent activity' });
    await user.click(trigger);

    await user.keyboard('{Escape}');

    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
    await waitFor(() => expect(screen.queryByText(/no activity yet/i)).not.toBeInTheDocument());
  });

  it('does not fetch while closed', () => {
    useCanvasStore.setState({ activeInstanceId: 'inst-1' });
    renderWithProviders(<ActivityFeed />);
    expect(getAuditLog).not.toHaveBeenCalled();
  });
});
