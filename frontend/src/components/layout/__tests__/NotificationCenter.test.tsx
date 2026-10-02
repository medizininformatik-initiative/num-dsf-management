import { describe, it, expect, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { useNotificationStore } from '../../../stores/notification.store';
import { NotificationCenter } from '../NotificationCenter';

describe('NotificationCenter', () => {
  beforeEach(() => {
    useNotificationStore.getState().clear();
  });

  it('renders the bell with no unread badge when empty', () => {
    renderWithProviders(<NotificationCenter />);
    const bell = screen.getByRole('button', { name: 'Notifications' });
    expect(bell).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows the unread badge after a notification is added', () => {
    useNotificationStore.getState().addNotification('Saved successfully', 'success');
    renderWithProviders(<NotificationCenter />);
    expect(screen.getByText('1')).toBeInTheDocument();
    // The count is part of the accessible name, not only of the visual badge.
    expect(screen.getByRole('button', { name: 'Notifications, 1 unread' })).toBeInTheDocument();
  });

  it('reveals the notification message when the dropdown is opened', async () => {
    const user = userEvent.setup();
    useNotificationStore.getState().addNotification('Endpoint updated', 'info');
    renderWithProviders(<NotificationCenter />);
    await user.click(screen.getByRole('button', { name: /notifications/i }));
    expect(screen.getByText(/Endpoint updated/i)).toBeInTheDocument();
  });

  it('opens an animated popover from the bell, moves focus into it and marks all read', async () => {
    const user = userEvent.setup();
    useNotificationStore.getState().addNotification('Endpoint updated', 'info');
    renderWithProviders(<NotificationCenter />);

    const bell = screen.getByRole('button', { name: /notifications/i });
    await user.click(bell);

    expect(bell).toHaveAttribute('aria-expanded', 'true');
    const panel = screen.getByRole('region', { name: 'Notifications' });
    expect(bell).toHaveAttribute('aria-controls', panel.id);
    expect(panel).toHaveAttribute('data-state', 'open');
    expect(panel.className).toContain('origin-top-right');
    expect(panel.className).toContain('data-[state=open]:animate-popover-in');
    expect(panel.className).toContain('glass-thin');
    expect(panel).toHaveFocus();
    expect(useNotificationStore.getState().unread).toBe(0);
  });

  it('closes on Escape, returns focus to the bell and unmounts after the exit', async () => {
    const user = userEvent.setup();
    renderWithProviders(<NotificationCenter />);
    const bell = screen.getByRole('button', { name: /notifications/i });
    await user.click(bell);

    await user.keyboard('{Escape}');

    expect(bell).toHaveAttribute('aria-expanded', 'false');
    expect(bell).toHaveFocus();
    // The exit animation keeps the panel briefly, hidden from assistive tech.
    expect(screen.queryByRole('region', { name: 'Notifications' })).not.toBeInTheDocument();
    expect(screen.getByText('No notifications yet.')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText('No notifications yet.')).not.toBeInTheDocument(),
    );
  });

  it('marks Escape as handled so a surrounding dialog does not close as well', async () => {
    const user = userEvent.setup();
    renderWithProviders(<NotificationCenter />);
    await user.click(screen.getByRole('button', { name: /notifications/i }));

    // fireEvent returns false when a handler called preventDefault().
    const notCancelled = fireEvent.keyDown(screen.getByRole('region', { name: 'Notifications' }), {
      key: 'Escape',
    });
    expect(notCancelled).toBe(false);
  });

  it('closes on a pointer-down outside the popover', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <div>
        <NotificationCenter />
        <p>elsewhere</p>
      </div>,
    );
    const bell = screen.getByRole('button', { name: /notifications/i });
    await user.click(bell);

    fireEvent.pointerDown(screen.getByText('elsewhere'));

    expect(bell).toHaveAttribute('aria-expanded', 'false');
  });

  it('stays open for clicks inside and clears the history on "Clear all"', async () => {
    const user = userEvent.setup();
    useNotificationStore.getState().addNotification('Endpoint updated', 'info');
    renderWithProviders(<NotificationCenter />);
    await user.click(screen.getByRole('button', { name: /notifications/i }));

    await user.click(screen.getByRole('button', { name: 'Clear all notifications' }));

    expect(screen.getByRole('button', { name: 'Notifications' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByText('No notifications yet.')).toBeInTheDocument();
    expect(useNotificationStore.getState().notifications).toHaveLength(0);
  });
});
