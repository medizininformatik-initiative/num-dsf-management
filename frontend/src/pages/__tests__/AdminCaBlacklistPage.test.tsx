/**
 * AdminCaBlacklistPage.test.tsx — the admin CA page with its whitelist and
 * blacklist tabs. caWhitelistApi and caBlacklistApi are mocked (four
 * whitelist entries, one blacklist entry). Covers the default whitelist tab
 * with both tab counts, switching tabs by click, arrow key and ?tab= URL, the
 * whitelist search (text and pasted fingerprint) and kind filter, and the
 * blacklist add with the 6-digit TOTP step-up. A separate describe block
 * mocks lib/authMode to exercise cert mode, where the TOTP field is not
 * rendered and add omits totpCode entirely.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import type { CaWhitelistRow } from '../../api/caWhitelist.api';

const { addMock, whitelistRows } = vi.hoisted(() => {
  const fp = (seed: string) => seed.repeat(64 / seed.length);
  const rows: CaWhitelistRow[] = [
    {
      id: 'w1',
      subject_dn: 'C=DE,O=Example Research Network,OU=PKI,CN=Example Issuing CA 2022',
      fingerprint: fp('0123456789ABCDEF'),
      kind: 'CLIENT',
      not_after: '2042-01-21',
      source: 'dsf-2.1.1',
      reason: null,
      added_by: 'SYSTEM:init',
      added_at: '2026-10-01T00:00:00Z',
    },
    {
      id: 'w2',
      subject_dn: 'C=NL,O=Example Association,CN=Example OV RSA CA 4',
      fingerprint: fp('FEDCBA9876543210'),
      kind: 'CLIENT',
      not_after: '2033-05-01',
      source: 'dsf-2.1.1',
      reason: null,
      added_by: 'SYSTEM:init',
      added_at: '2026-10-01T00:00:00Z',
    },
    {
      id: 'w3',
      subject_dn: 'C=US,O=Example Trust Network,CN=Example RSA Root',
      fingerprint: fp('AB12'),
      kind: 'SERVER',
      not_after: '2038-01-18',
      source: 'dsf-2.1.1',
      reason: null,
      added_by: 'SYSTEM:init',
      added_at: '2026-10-01T00:00:00Z',
    },
    {
      id: 'w4',
      subject_dn: 'CN=Hackathon Test CA,O=Example Lab,C=DE',
      fingerprint: null,
      kind: 'CLIENT',
      not_after: null,
      source: 'manual',
      reason: 'test federation',
      added_by: 'admin@imi.example.de',
      added_at: '2026-09-30T10:00:00Z',
    },
  ];
  return {
    addMock: vi.fn().mockResolvedValue({ data: { data: { id: 'new' } } }),
    whitelistRows: rows,
  };
});

vi.mock('../../api/caBlacklist.api', () => ({
  caBlacklistApi: {
    list: vi.fn().mockResolvedValue({
      data: {
        data: {
          blacklist: [
            {
              id: 'b1',
              subject_dn: 'CN=Bad CA',
              fingerprint: null,
              reason: 'compromised',
              added_by: 'admin@example.com',
              added_at: '2026-01-01T00:00:00Z',
            },
          ],
          knownCas: [],
        },
      },
    }),
    add: addMock,
    remove: vi.fn(),
  },
}));

vi.mock('../../api/caWhitelist.api', () => ({
  caWhitelistApi: {
    list: vi
      .fn()
      .mockResolvedValue({ data: { data: { whitelist: whitelistRows, enforced: false } } }),
    add: vi.fn(),
    remove: vi.fn(),
  },
}));

// Defaults to OTP mode (cert: false) so the tests below run through the real
// needsTotpStepUp()===true behaviour; the cert mode block flips this.
const authMode = vi.hoisted(() => ({ cert: false }));
vi.mock('../../lib/authMode', () => ({
  isCertMode: () => authMode.cert,
  needsTotpStepUp: () => !authMode.cert,
}));

import { AdminCaBlacklistPage } from '../AdminCaBlacklistPage';
import { caBlacklistApi } from '../../api/caBlacklist.api';

const BLACKLIST_ROUTE = '/app/admin/ca-blacklist?tab=blacklist';

function whitelistPanel() {
  return document.getElementById('ca-panel-whitelist') as HTMLElement;
}

beforeEach(() => {
  authMode.cert = false;
  addMock.mockReset();
  addMock.mockResolvedValue({ data: { data: { id: 'new' } } });
});

describe('AdminCaBlacklistPage', () => {
  it('opens on the whitelist tab with both lists counted', async () => {
    renderWithProviders(<AdminCaBlacklistPage />);
    expect(screen.getByRole('heading', { name: 'Certificate authorities' })).toBeInTheDocument();

    const whitelistTab = screen.getByRole('tab', { name: /CA Whitelist/ });
    const blacklistTab = screen.getByRole('tab', { name: /CA Blacklist/ });
    expect(whitelistTab).toHaveAttribute('aria-selected', 'true');
    expect(blacklistTab).toHaveAttribute('aria-selected', 'false');

    // Counts appear in the tabs once both lists have loaded.
    await waitFor(() => expect(whitelistTab).toHaveTextContent('4'));
    await waitFor(() => expect(blacklistTab).toHaveTextContent('1'));

    expect(await screen.findAllByTestId('ca-whitelist-row')).toHaveLength(4);
    expect(whitelistPanel()).toBeVisible();
    expect(document.getElementById('ca-panel-blacklist')).not.toBeVisible();
  });

  it('switches tabs by click and by arrow key', async () => {
    renderWithProviders(<AdminCaBlacklistPage />);
    const whitelistTab = screen.getByRole('tab', { name: /CA Whitelist/ });
    const blacklistTab = screen.getByRole('tab', { name: /CA Blacklist/ });

    fireEvent.click(blacklistTab);
    expect(blacklistTab).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('CN=Bad CA')).toBeVisible();

    fireEvent.keyDown(blacklistTab, { key: 'ArrowRight' });
    expect(whitelistTab).toHaveAttribute('aria-selected', 'true');
    expect(whitelistTab).toHaveFocus();
    expect(whitelistPanel()).toBeVisible();
  });

  it('opens the tab named in the URL', async () => {
    renderWithProviders(<AdminCaBlacklistPage />, { route: BLACKLIST_ROUTE });
    expect(screen.getByRole('tab', { name: /CA Blacklist/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(await screen.findByText('CN=Bad CA')).toBeVisible();
  });

  it('filters the whitelist by text, by pasted fingerprint and by kind', async () => {
    renderWithProviders(<AdminCaBlacklistPage />);
    await screen.findAllByTestId('ca-whitelist-row');
    const search = screen.getByRole('searchbox', { name: 'Search the whitelist' });

    fireEvent.change(search, { target: { value: 'ov rsa' } });
    let rows = screen.getAllByTestId('ca-whitelist-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('Example OV RSA CA 4');
    expect(screen.getByText('Showing 1 of 4')).toBeInTheDocument();

    // A fingerprint fragment pasted with colons still matches.
    fireEvent.change(search, { target: { value: 'fe:dc:ba:98' } });
    rows = screen.getAllByTestId('ca-whitelist-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('Example OV RSA CA 4');

    // Manual entries are found by their source label.
    fireEvent.change(search, { target: { value: 'manual' } });
    expect(screen.getAllByTestId('ca-whitelist-row')[0]).toHaveTextContent('Hackathon Test CA');

    fireEvent.change(search, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Server roots' }));
    expect(screen.getByRole('button', { name: 'Server roots' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    rows = screen.getAllByTestId('ca-whitelist-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('Example RSA Root');
    expect(
      within(whitelistPanel()).queryByRole('heading', { name: /Client CAs/ }),
    ).not.toBeInTheDocument();
  });

  it('disables add until a 6-digit TOTP code is entered, then sends it', async () => {
    renderWithProviders(<AdminCaBlacklistPage />, { route: BLACKLIST_ROUTE });
    await screen.findByText('CN=Bad CA');

    const subjectInput = screen.getByTestId('ca-blacklist-subject-input');
    const totpInput = screen.getByTestId('ca-blacklist-totp-input');
    const addBtn = screen.getByTestId('ca-blacklist-add-btn') as HTMLButtonElement;

    fireEvent.change(subjectInput, { target: { value: 'CN=New CA,O=Test,C=DE' } });
    // Without a TOTP code the add button stays disabled.
    expect(addBtn).toBeDisabled();

    fireEvent.change(totpInput, { target: { value: '123456' } });
    expect(addBtn).not.toBeDisabled();

    fireEvent.click(addBtn);

    await waitFor(() =>
      expect(caBlacklistApi.add).toHaveBeenCalledWith(
        expect.objectContaining({ subjectDn: 'CN=New CA,O=Test,C=DE', totpCode: '123456' }),
      ),
    );
  });
});

describe('AdminCaBlacklistPage (cert mode)', () => {
  beforeEach(() => {
    authMode.cert = true;
  });

  it('renders no TOTP field and add sends no totpCode', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminCaBlacklistPage />, { route: BLACKLIST_ROUTE });
    await screen.findByText('CN=Bad CA');

    expect(screen.queryByTestId('ca-blacklist-totp-input')).not.toBeInTheDocument();
    expect(screen.queryByText('TOTP code')).not.toBeInTheDocument();

    const subjectInput = screen.getByTestId('ca-blacklist-subject-input');
    const addBtn = screen.getByTestId('ca-blacklist-add-btn') as HTMLButtonElement;

    await user.type(subjectInput, 'CN=New CA,O=Test,C=DE');
    // No TOTP code needed — the subject DN alone enables the button.
    expect(addBtn).not.toBeDisabled();

    await user.click(addBtn);

    await waitFor(() => expect(addMock).toHaveBeenCalledTimes(1));
    const arg = addMock.mock.calls[0][0];
    expect(arg).toEqual({ subjectDn: 'CN=New CA,O=Test,C=DE', reason: '' });
    expect(Object.prototype.hasOwnProperty.call(arg, 'totpCode')).toBe(false);
  });
});
