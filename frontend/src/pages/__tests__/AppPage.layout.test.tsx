/**
 * AppPage.layout.test.tsx — responsive shell behaviour. The real Sidebar and
 * Drawer render; the TopBar, canvas, status panel and modals are stubs.
 * window.matchMedia is faked so the tests can cross the 1200 px breakpoint:
 * wide → collapsible columns (sidebar → 64 px rail, status panel → 48 px
 * rail); narrow → rails below the TopBar that open modal drawers. The user's
 * column choice survives crossing the breakpoint; drawers close on crossing
 * and on navigation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import { useCanvasStore } from '../../stores/canvas.store';
import { useAuthStore } from '../../stores/auth.store';
import {
  installMatchMedia,
  type FakeMatchMedia,
} from '../../components/layout/__tests__/fakeMatchMedia';

vi.mock('../../hooks/useInstance', () => ({
  useInstances: () => ({ data: [{ id: 'inst-1', label: 'alpha.example.de' }], isLoading: false }),
  useInstance: () => ({ data: undefined }),
}));
vi.mock('../../hooks/useMe', () => ({
  useMe: () => ({ data: { email: 'op@imi-test.example.de', isAdmin: false }, isLoading: false }),
}));
vi.mock('../../hooks/useOrganization', () => ({
  useOrganization: () => ({ data: undefined }),
}));

vi.mock('../../components/layout/TopBar', () => ({
  TopBar: () => <header data-testid="topbar" />,
}));
vi.mock('../../components/layout/RightPanel', () => ({
  RightPanel: () => <aside aria-label="Approval status">status panel</aside>,
}));
vi.mock('../../components/canvas/EntityCanvas', () => ({
  EntityCanvas: () => <div>canvas</div>,
}));
vi.mock('../../components/layout/Breadcrumbs', () => ({ Breadcrumbs: () => null }));
vi.mock('../../components/layout/ExpiryWarningBanner', () => ({
  ExpiryWarningBanner: () => null,
}));
vi.mock('../../components/layout/CrossUserInstanceBanner', () => ({
  CrossUserInstanceBanner: () => null,
}));
vi.mock('../../components/layout/CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('../../components/map/MapHeader', () => ({ MapHeader: () => null }));
vi.mock('../../components/canvas/ActivityFeed', () => ({ ActivityFeed: () => null }));
vi.mock('../../components/modals/OrganizationModal', () => ({ OrganizationModal: () => null }));
vi.mock('../../components/modals/ContactModal', () => ({ ContactModal: () => null }));
vi.mock('../../components/modals/EndpointModal', () => ({ EndpointModal: () => null }));
vi.mock('../../components/modals/CertificateModal', () => ({ CertificateModal: () => null }));
vi.mock('../../components/modals/MembershipModal', () => ({ MembershipModal: () => null }));
vi.mock('../../components/modals/ApprovalModal', () => ({ ApprovalModal: () => null }));
vi.mock('../../components/modals/DownloadModal', () => ({ DownloadModal: () => null }));
vi.mock('../../components/modals/CertRenewalModal', () => ({ CertRenewalModal: () => null }));

import { AppPage } from '../AppPage';

let media: FakeMatchMedia;

function renderShell(wide: boolean, route = '/app') {
  media = installMatchMedia(wide);
  return renderWithProviders(<AppPage />, { route });
}

const sidebarColumn = () => document.getElementById('app-sidebar') as HTMLElement;
const statusColumn = () => document.getElementById('app-status-panel');

beforeEach(() => {
  act(() => {
    useCanvasStore.setState({ activeInstanceId: 'inst-1' });
    useAuthStore.getState().setTokens('tok', { id: 'u1', email: 'op@imi-test.example.de' });
  });
});

afterEach(() => {
  media.uninstall();
});

describe('AppPage wide layout (>= 1200 px)', () => {
  it('puts the sidebar column beside the TopBar and collapses it to a rail', async () => {
    const user = userEvent.setup();
    renderShell(true);

    // The sidebar is the first column; the TopBar starts to its right.
    expect(
      sidebarColumn().compareDocumentPosition(screen.getByTestId('topbar')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(sidebarColumn().className).toContain('w-[220px]');
    expect(sidebarColumn().className).toContain('transition-[width]');

    const collapse = screen.getByRole('button', { name: 'Collapse navigation' });
    expect(collapse).toHaveAttribute('aria-expanded', 'true');
    expect(collapse).toHaveAttribute('aria-controls', 'app-sidebar');

    await user.click(collapse);

    expect(sidebarColumn().className).toContain('w-16');
    // The width waits for the labels to leave; expanding starts at once.
    expect(sidebarColumn().className).toContain('delay-[var(--duration-micro-exit)]');
    const expand = screen.getByRole('button', { name: 'Expand navigation' });
    expect(expand).toHaveAttribute('aria-expanded', 'false');
    expect(expand).toHaveAttribute('aria-controls', 'app-sidebar');

    await user.click(expand);
    expect(sidebarColumn().className).toContain('w-[220px]');
    expect(sidebarColumn().className).not.toContain('delay-');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('collapses the status panel to a rail and expands it again', async () => {
    const user = userEvent.setup();
    renderShell(true);
    expect(screen.getByRole('complementary', { name: 'Approval status' })).toBeInTheDocument();

    const hide = screen.getByRole('button', { name: 'Hide instance status' });
    expect(hide).toHaveAttribute('aria-expanded', 'true');
    expect(hide).toHaveAttribute('aria-controls', 'app-status-panel');
    await user.click(hide);

    expect(statusColumn()?.className).toContain('w-12');
    const show = screen.getByRole('button', { name: 'Show instance status' });
    expect(show).toHaveAttribute('aria-expanded', 'false');
    expect(show).toHaveAttribute('aria-controls', 'app-status-panel');
    // The panel stays for the collapse transition, then unmounts.
    await waitFor(() => expect(screen.queryByText('status panel')).not.toBeInTheDocument());

    await user.click(show);
    expect(statusColumn()?.className).toContain('w-[280px]');
    expect(screen.getByRole('complementary', { name: 'Approval status' })).toBeInTheDocument();
  });

  it('shows the status column only on the canvas route', () => {
    renderShell(true, '/app/status');
    expect(statusColumn()).toBeNull();
    expect(screen.queryByRole('button', { name: /instance status/i })).not.toBeInTheDocument();
  });

  it('keeps the collapsed sidebar on resize events that do not cross the breakpoint', async () => {
    const user = userEvent.setup();
    renderShell(true);
    await user.click(screen.getByRole('button', { name: 'Collapse navigation' }));

    act(() => {
      window.dispatchEvent(new Event('resize'));
    });

    expect(screen.getByRole('button', { name: 'Expand navigation' })).toBeInTheDocument();
  });
});

describe('AppPage narrow layout (< 1200 px)', () => {
  it('shows rails below a full-width TopBar', () => {
    renderShell(false);
    expect(
      screen.getByTestId('topbar').compareDocumentPosition(sidebarColumn()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(sidebarColumn().className).toContain('w-16');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('status panel')).not.toBeInTheDocument();
  });

  it('opens the navigation drawer, focuses its close button and closes on Escape', async () => {
    const user = userEvent.setup();
    renderShell(false);
    const expand = screen.getByRole('button', { name: 'Expand navigation' });
    expect(expand).toHaveAttribute('aria-controls', 'app-nav-drawer');

    await user.click(expand);

    const drawer = screen.getByRole('dialog', { name: 'Navigation' });
    expect(drawer).toHaveAttribute('aria-modal', 'true');
    expect(drawer).toHaveAttribute('id', 'app-nav-drawer');
    expect(drawer.className).toContain('animate-sheet-in-left');
    expect(drawer.className).toContain('glass-thick');
    expect(screen.getByRole('button', { name: 'Close navigation' })).toHaveFocus();

    await user.keyboard('{Escape}');

    await waitFor(() => expect(document.getElementById('app-nav-drawer')).toBeNull());
    expect(expand).toHaveFocus();
  });

  it('opens the status panel drawer from its rail and closes it from its button', async () => {
    const user = userEvent.setup();
    renderShell(false);
    const show = screen.getByRole('button', { name: 'Show instance status' });
    expect(show).toHaveAttribute('aria-controls', 'app-status-drawer');

    await user.click(show);

    const drawer = screen.getByRole('dialog', { name: 'Instance status' });
    expect(drawer.className).toContain('animate-sheet-in-right');
    expect(drawer).toHaveTextContent('status panel');
    const close = screen.getByRole('button', { name: 'Close instance status' });
    expect(close).toHaveFocus();

    await user.click(close);
    await waitFor(() => expect(document.getElementById('app-status-drawer')).toBeNull());
  });

  it('closes the navigation drawer after navigating', async () => {
    const user = userEvent.setup();
    renderShell(false);
    await user.click(screen.getByRole('button', { name: 'Expand navigation' }));

    const drawer = screen.getByRole('dialog', { name: 'Navigation' });
    const mapLink = Array.from(drawer.querySelectorAll('a')).find(
      (a) => a.getAttribute('href') === '/app/map',
    ) as HTMLAnchorElement;
    await user.click(mapLink);

    await waitFor(() => expect(document.getElementById('app-nav-drawer')).toBeNull());
  });
});

describe('AppPage breakpoint crossing', () => {
  it('keeps the column choice and closes an open drawer', async () => {
    const user = userEvent.setup();
    renderShell(true);
    await user.click(screen.getByRole('button', { name: 'Collapse navigation' }));

    media.set(false);
    await user.click(screen.getByRole('button', { name: 'Expand navigation' }));
    expect(screen.getByRole('dialog', { name: 'Navigation' })).toBeInTheDocument();

    media.set(true);

    await waitFor(() => expect(document.getElementById('app-nav-drawer')).toBeNull());
    // Back above the breakpoint the sidebar is still collapsed, as the user left it.
    const expand = screen.getByRole('button', { name: 'Expand navigation' });
    expect(expand).toHaveAttribute('aria-controls', 'app-sidebar');
    expect(sidebarColumn().className).toContain('w-16');
  });

  it('starts expanded again when the user had not collapsed the columns', () => {
    renderShell(false);
    media.set(true);
    expect(screen.getByRole('button', { name: 'Collapse navigation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide instance status' })).toBeInTheDocument();
  });
});
