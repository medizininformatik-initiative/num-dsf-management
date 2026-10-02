import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { CrossUserInstanceBanner } from '../CrossUserInstanceBanner';

let me: any = { email: 'admin@imi-test.example.de', isAdmin: true };
let instance: any = { id: 'i1', label: 'Foreign', owner_email: 'someone-else@example.de' };

vi.mock('../../../hooks/useMe', () => ({
  useMe: () => ({ data: me, isLoading: false }),
}));
vi.mock('../../../hooks/useInstance', () => ({
  useInstance: () => ({ data: instance, isLoading: false }),
}));

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MemoryRouter>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
}

describe('CrossUserInstanceBanner', () => {
  it('renders the warning when an IMI admin views an instance owned by another user', () => {
    me = { email: 'admin@imi-test.example.de', isAdmin: true };
    instance = { id: 'i1', label: 'Foreign', owner_email: 'someone-else@example.de' };
    render(
      <Wrapper>
        <CrossUserInstanceBanner instanceId="i1" />
      </Wrapper>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/another user/i)).toBeInTheDocument();
    expect(screen.getByText(/someone-else@example\.de/)).toBeInTheDocument();
  });

  it('does NOT render when the active instance is owned by the current user', () => {
    me = { email: 'admin@imi-test.example.de', isAdmin: true };
    instance = { id: 'i1', label: 'Mine', owner_email: 'admin@imi-test.example.de' };
    render(
      <Wrapper>
        <CrossUserInstanceBanner instanceId="i1" />
      </Wrapper>,
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does NOT render for non-admins even when the instance owner differs', () => {
    me = { email: 'member@imi-test.example.de', isAdmin: false };
    instance = { id: 'i1', label: 'Foreign', owner_email: 'someone-else@example.de' };
    render(
      <Wrapper>
        <CrossUserInstanceBanner instanceId="i1" />
      </Wrapper>,
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('CrossUserInstanceBanner (shared harness)', () => {
  it('renders the cross-user alert through renderWithProviders', () => {
    me = { email: 'admin@imi-test.example.de', isAdmin: true };
    instance = { id: 'i1', label: 'Foreign', owner_email: 'someone-else@example.de' };
    renderWithProviders(<CrossUserInstanceBanner instanceId="i1" />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/someone-else@example\.de/)).toBeInTheDocument();
  });

  it('uses the warning tone tokens and addresses German users formally', () => {
    me = { email: 'admin@imi-test.example.de', isAdmin: true };
    instance = { id: 'i1', label: 'Foreign', owner_email: 'someone-else@example.de' };
    renderWithProviders(<CrossUserInstanceBanner instanceId="i1" />, { lang: 'de' });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveClass('bg-warning-surface', 'border-warning-border', 'text-warning-fg');
    expect(alert).not.toHaveAttribute('style');
    expect(
      screen.getByText('Sie betrachten die Instanz eines anderen Benutzers'),
    ).toBeInTheDocument();
  });

  it('renders nothing when no instanceId is supplied', () => {
    me = { email: 'admin@imi-test.example.de', isAdmin: true };
    instance = { id: 'i1', label: 'Foreign', owner_email: 'someone-else@example.de' };
    renderWithProviders(<CrossUserInstanceBanner instanceId={null} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
