/**
 * Sidebar.badge.test.tsx — the pending-request count pill on the approval
 * review link and the Administration section header (admins only, count > 0).
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';
import { Sidebar } from '../Sidebar';

const pending = vi.hoisted(() => ({ data: [] as { id: string }[] }));
const me = vi.hoisted(() => ({ isAdmin: true }));
vi.mock('../../../hooks/useInstance', () => ({
  useInstances: () => ({ data: [{ id: 'i1', label: 'Test Instance' }], isLoading: false }),
}));
vi.mock('../../../hooks/useMe', () => ({
  useMe: () => ({ data: { email: 'a@x.de', isAdmin: me.isAdmin }, isLoading: false }),
}));
vi.mock('../../../hooks/useAdmin', () => ({ usePendingApprovals: () => ({ data: pending.data }) }));

function renderSidebar(path = '/app/admin') {
  const qc = new QueryClient();
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={qc}>
        <Sidebar initialGroup="admin" />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('Sidebar pending badge', () => {
  it('shows the count with an accessible label for admins', () => {
    me.isAdmin = true;
    pending.data = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    renderSidebar();
    expect(screen.getAllByLabelText('3 open requests').length).toBeGreaterThan(0);
  });

  it('uses the singular for one request', () => {
    me.isAdmin = true;
    pending.data = [{ id: 'a' }];
    renderSidebar();
    expect(screen.getAllByLabelText('1 open request').length).toBeGreaterThan(0);
  });

  it('shows no badge without pending requests', () => {
    me.isAdmin = true;
    pending.data = [];
    renderSidebar();
    expect(screen.queryByLabelText(/open requests/)).toBeNull();
  });

  it('shows no badge for non-admins', () => {
    me.isAdmin = false;
    pending.data = [{ id: 'a' }];
    renderSidebar();
    expect(screen.queryByLabelText(/open requests/)).toBeNull();
  });
});
