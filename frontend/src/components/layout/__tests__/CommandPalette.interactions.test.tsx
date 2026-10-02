/**
 * CommandPalette.interactions.test.tsx — exercises the palette's command flow:
 * opening on Ctrl+K, filtering by typed query, ArrowDown+Enter running the
 * selected command (navigation + store mutation), Escape closing through the
 * dialog stack (only the top-most dialog closes), the combobox/listbox
 * semantics and the empty-results state. Data hooks (useInstances/useMe) are
 * mocked; the real Zustand stores (useModals, useCanvasStore) are read back to
 * assert actions fired, and a LocationProbe observes router navigation. Query
 * input changes use fireEvent.change for a single deterministic update. The
 * palette unmounts after its exit animation, hence waitFor on closing.
 */
import { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useI18n } from '../../../stores/i18n.store';
import { useModals } from '../../../hooks/useModals';
import { useCanvasStore } from '../../../stores/canvas.store';
import { DialogShell } from '../../ui/DialogShell';

vi.mock('../../../hooks/useInstance', () => ({
  useInstances: () => ({ data: [{ id: 'inst-1', label: 'Acme Test' }], isLoading: false }),
}));
vi.mock('../../../hooks/useMe', () => ({
  useMe: () => ({ data: { email: 'admin@example.de', isAdmin: true }, isLoading: false }),
}));

import { CommandPalette } from '../CommandPalette';

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname}</div>;
}

function renderPalette() {
  useI18n.getState().setLang('en');
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={['/app/audit']}>
      <QueryClientProvider client={qc}>
        <CommandPalette />
        <LocationProbe />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function openPalette() {
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
}

function setQuery(value: string) {
  const input = screen.getByPlaceholderText(/type a command/i);
  fireEvent.change(input, { target: { value } });
}

describe('CommandPalette interactions', () => {
  beforeEach(() => {
    // Reset shared Zustand state so each test starts clean.
    useModals.setState({ open: null, editId: null });
    useCanvasStore.setState({ activeInstanceId: null });
  });

  it('lists navigation and action commands once opened', () => {
    renderPalette();
    openPalette();

    expect(screen.getByText('Go to Canvas')).toBeInTheDocument();
    expect(screen.getByText('Edit Organization')).toBeInTheDocument();
    // Admin-only command is visible because the mocked user is an admin.
    expect(screen.getByText('Approval Review')).toBeInTheDocument();
  });

  it('filters the command list as the query is typed', () => {
    renderPalette();
    openPalette();

    setQuery('contact');

    expect(screen.getByText('Add Contact')).toBeInTheDocument();
    // Unrelated commands are filtered out.
    expect(screen.queryByText('Go to Canvas')).not.toBeInTheDocument();
    expect(screen.queryByText('Edit Organization')).not.toBeInTheDocument();
  });

  it('runs the selected command on Enter, navigating via the router', async () => {
    renderPalette();
    openPalette();
    expect(screen.getByTestId('location').textContent).toBe('/app/audit');

    // Narrow to a single navigation command, then run it with Enter.
    setQuery('canvas');
    const input = screen.getByPlaceholderText(/type a command/i);
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByTestId('location').textContent).toBe('/app');
    // Running a command also closes the palette (it unmounts after its exit).
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByPlaceholderText(/type a command/i)).not.toBeInTheDocument(),
    );
  });

  it('moves the selection with ArrowDown before running it', () => {
    renderPalette();
    openPalette();

    // Two action commands match "add c": Add Contact, then Add Certificate.
    setQuery('add c');
    expect(screen.getByText('Add Contact')).toBeInTheDocument();
    expect(screen.getByText('Add Certificate')).toBeInTheDocument();

    const input = screen.getByPlaceholderText(/type a command/i);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    // Second match (Add Certificate) opens the certificate-add modal.
    expect(useModals.getState().open).toBe('certificate-add');
  });

  it('re-clamps the selection when the filtered list shrinks before Enter', () => {
    renderPalette();
    openPalette();

    const input = screen.getByPlaceholderText(/type a command/i);
    // Move the selection down a couple of times over the full list.
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });

    // Type a query that shrinks the list down to a single match.
    setQuery('Download Allow List');
    expect(screen.getByText('Download Allow List')).toBeInTheDocument();

    // Enter must run the in-range (first/only) command, not a stale index.
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(useModals.getState().open).toBe('download');
  });

  it('runs the instance-switch command, updating the active instance', () => {
    renderPalette();
    openPalette();

    setQuery('Acme');
    expect(screen.getByText('Switch to Acme Test')).toBeInTheDocument();

    const input = screen.getByPlaceholderText(/type a command/i);
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(useCanvasStore.getState().activeInstanceId).toBe('inst-1');
    expect(screen.getByTestId('location').textContent).toBe('/app');
  });

  it('closes on Escape through the dialog stack, not a window listener', async () => {
    renderPalette();
    openPalette();
    const input = screen.getByPlaceholderText(/type a command/i);

    // A bare window event no longer closes it: Escape is the dialog layer's job.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByPlaceholderText(/type a command/i)).not.toBeInTheDocument(),
    );
  });

  it('lets a dialog opened on top of it take Escape first', async () => {
    function OnTop() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>open on top</button>
          <DialogShell open={open} onDismiss={() => setOpen(false)} labelledBy="on-top-title">
            <h2 id="on-top-title">On top</h2>
          </DialogShell>
        </>
      );
    }
    useI18n.getState().setLang('en');
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <MemoryRouter>
        <QueryClientProvider client={qc}>
          <CommandPalette />
          <OnTop />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    openPalette();
    fireEvent.click(screen.getByRole('button', { name: 'open on top', hidden: true }));
    expect(screen.getByRole('dialog', { name: 'On top' })).toBeInTheDocument();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });

    // Only the top-most dialog closed; the palette is still open.
    expect(screen.queryByRole('dialog', { name: 'On top' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
  });

  it('exposes the commands as a listbox driven by the combobox', () => {
    renderPalette();
    openPalette();
    const combobox = screen.getByRole('combobox', { name: 'Command palette' });
    const listbox = screen.getByRole('listbox', { name: 'Command palette' });
    expect(combobox).toHaveAttribute('aria-controls', listbox.id);

    const first = screen.getByRole('option', { name: 'Go to Canvas' });
    expect(first).toHaveAttribute('aria-selected', 'true');
    expect(combobox).toHaveAttribute('aria-activedescendant', first.id);

    fireEvent.keyDown(combobox, { key: 'ArrowDown' });

    const second = screen.getByRole('option', { name: 'Approval Review' });
    expect(second).toHaveAttribute('aria-selected', 'true');
    expect(first).toHaveAttribute('aria-selected', 'false');
    expect(combobox).toHaveAttribute('aria-activedescendant', second.id);
  });

  it('shows the empty-results state for a query with no matches', () => {
    renderPalette();
    openPalette();

    setQuery('zzz-no-such-command');

    expect(screen.getByText('No commands found.')).toBeInTheDocument();
    expect(screen.queryByText('Go to Canvas')).not.toBeInTheDocument();
  });
});
