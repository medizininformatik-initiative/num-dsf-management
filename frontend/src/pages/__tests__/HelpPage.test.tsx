/**
 * HelpPage.test.tsx — the user help: all sections and their TOC links render in EN and
 * DE, the certtool command and the DSF link are copyable code lines, the search narrows
 * sections and FAQ live (with an empty state), TOC clicks and #anchors scroll through
 * scrollIntoViewSafe, a FAQ deep link opens its answer, and admins get a link to the
 * admin reference. The auth hook is mocked; the page has no network access.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import { HELP_FAQ, HELP_SECTIONS } from '../../lib/helpContent';

const me = vi.hoisted(() => ({ isAdmin: false }));
vi.mock('../../hooks/useMe', () => ({ useMe: () => ({ data: { isAdmin: me.isAdmin } }) }));

const scrollSafe = vi.hoisted(() => vi.fn());
vi.mock('../../lib/motion', async (orig) => ({
  ...(await orig<typeof import('../../lib/motion')>()),
  scrollIntoViewSafe: scrollSafe,
}));

import { HelpPage } from '../HelpPage';
import { en } from '../../i18n/en';
import { de } from '../../i18n/de';

beforeEach(() => {
  me.isAdmin = false;
  scrollSafe.mockReset();
});

describe('HelpPage', () => {
  it('renders every section, the FAQ and the contact block with a TOC link each', () => {
    renderWithProviders(<HelpPage />, { route: '/app/help' });
    expect(screen.getByRole('heading', { level: 1, name: 'Help' })).toBeInTheDocument();
    const toc = screen.getByRole('navigation', { name: 'On this page' });
    for (const s of HELP_SECTIONS) {
      expect(screen.getByRole('heading', { level: 2, name: en[s.titleKey] })).toBeInTheDocument();
      expect(within(toc).getByRole('link', { name: en[s.tocKey] })).toHaveAttribute(
        'href',
        `#${s.id}`,
      );
    }
    expect(screen.getByRole('heading', { name: 'Frequently asked questions' })).toBeInTheDocument();
    expect(within(toc).getByRole('link', { name: 'FAQ' })).toHaveAttribute('href', '#faq');
    expect(within(toc).getByRole('link', { name: 'Support' })).toHaveAttribute('href', '#contact');
  });

  it('is fully translated into German with the formal address', () => {
    renderWithProviders(<HelpPage />, { route: '/app/help', lang: 'de' });
    expect(screen.getByRole('heading', { level: 1, name: 'Hilfe' })).toBeInTheDocument();
    expect(
      screen.getByText(/Laden Sie das öffentliche Client-Zertifikat hoch/),
    ).toBeInTheDocument();
    for (const s of HELP_SECTIONS) {
      expect(de[s.titleKey]).not.toBe(en[s.titleKey]);
    }
    expect(de.helpS_start_0).toMatch(/Ihres Standorts/);
  });

  it('covers the thumbprint, certtool command, MEDIC role, DSF link and import steps', () => {
    renderWithProviders(<HelpPage />, { route: '/app/help' });
    expect(
      screen.getByText('certtool --fingerprint --hash=sha512 --infile=client_certificate.pem'),
    ).toBeInTheDocument();
    expect(screen.getByText(`${window.location.origin}/fhir/Bundle/mine`)).toBeInTheDocument();
    expect(screen.getAllByText(/MEDIC role/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/downloadAllowList/).length).toBeGreaterThan(0);
  });

  it('copies a code line', async () => {
    const user = userEvent.setup();
    renderWithProviders(<HelpPage />, { route: '/app/help' });
    await user.click(
      screen.getByRole('button', {
        name: 'Copy certtool --fingerprint --hash=sha512 --infile=client_certificate.pem',
      }),
    );
    await expect(navigator.clipboard.readText()).resolves.toBe(
      'certtool --fingerprint --hash=sha512 --infile=client_certificate.pem',
    );
  });

  it('narrows sections and FAQ entries while typing and offers a reset', async () => {
    const user = userEvent.setup();
    renderWithProviders(<HelpPage />, { route: '/app/help' });
    await user.type(screen.getByRole('searchbox', { name: 'Search the help' }), 'certtool');
    expect(screen.getByRole('heading', { name: en.helpS_certificates_title })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: en.helpS_organization_title })).toBeNull();
    const toc = screen.getByRole('navigation', { name: 'On this page' });
    expect(within(toc).queryByRole('link', { name: 'Organization' })).toBeNull();
    // The FAQ entry on thumbprints mentions certtool as well.
    expect(screen.getByText(/The thumbprint differs/)).toBeInTheDocument();
    expect(screen.queryByText(/How long does a review take/)).toBeNull();

    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'zzzz-nothing');
    expect(screen.getByRole('status')).toHaveTextContent('Nothing found for "zzzz-nothing".');
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByRole('heading', { name: en.helpS_organization_title })).toBeInTheDocument();
  });

  it('scrolls to a section through scrollIntoViewSafe when a TOC link is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<HelpPage />, { route: '/app/help' });
    await user.click(screen.getByRole('link', { name: 'Memberships' }));
    expect(scrollSafe).toHaveBeenCalledTimes(1);
    expect(scrollSafe.mock.calls[0][0]).toHaveAttribute('id', 'memberships');
    expect(window.location.hash).toBe('#memberships');
  });

  it('marks the clicked TOC entry as current even when the page cannot scroll to it', async () => {
    const user = userEvent.setup();
    renderWithProviders(<HelpPage />, { route: '/app/help' });
    const toc = screen.getByRole('navigation', { name: 'On this page' });
    await user.click(within(toc).getByRole('link', { name: 'FAQ' }));
    expect(within(toc).getByRole('link', { name: 'FAQ' })).toHaveAttribute(
      'aria-current',
      'location',
    );
    expect(within(toc).getByRole('link', { name: 'Support' })).not.toHaveAttribute('aria-current');
  });

  it('follows a #anchor on load and opens a FAQ answer deep link', () => {
    const id = HELP_FAQ[1].id;
    renderWithProviders(<HelpPage />, { route: `/app/help#${id}` });
    const entry = document.getElementById(id) as HTMLDetailsElement;
    expect(entry.open).toBe(true);
    expect(scrollSafe).toHaveBeenCalledWith(entry, { block: 'start' });
    expect(document.getElementById(HELP_FAQ[0].id)).not.toHaveAttribute('open');
  });

  it('shows the FAQ collapsed by default', () => {
    renderWithProviders(<HelpPage />, { route: '/app/help' });
    for (const f of HELP_FAQ) expect(document.getElementById(f.id)).not.toHaveAttribute('open');
  });

  it('links admins to the admin reference, others not', () => {
    const { unmount } = renderWithProviders(<HelpPage />, { route: '/app/help' });
    expect(screen.queryByRole('link', { name: /admin reference/i })).toBeNull();
    unmount();
    me.isAdmin = true;
    renderWithProviders(<HelpPage />, { route: '/app/help' });
    expect(screen.getByRole('link', { name: /admin reference/i })).toHaveAttribute(
      'href',
      '/app/admin/help',
    );
  });
});
