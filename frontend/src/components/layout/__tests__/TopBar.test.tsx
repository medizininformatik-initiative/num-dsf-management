/**
 * TopBar.test.tsx — no history arrows and no duplicate product title
 * or environment badge (both live in the sidebar), and the instance actions: one primary CTA that is
 * disabled and relabelled "Waiting for approval" while the active instance has
 * a PENDING request. Entity and approval hooks are stubbed.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { useCanvasStore } from '../../../stores/canvas.store';

const approval = vi.hoisted(() => ({ data: null as Record<string, unknown> | null }));
const useApprovalStatus = vi.hoisted(() => vi.fn(() => ({ data: approval.data })));
const freshness = vi.hoisted(() => ({ data: undefined as Record<string, unknown> | undefined }));
const useAllowListFreshness = vi.hoisted(() => vi.fn(() => ({ data: freshness.data })));

// SearchBar (rendered when showInstanceActions) pulls in entity hooks — stub them all.
vi.mock('../../../hooks/useOrganization', () => ({ useOrganization: () => ({ data: null }) }));
vi.mock('../../../hooks/useContacts', () => ({ useContacts: () => ({ data: [] }) }));
vi.mock('../../../hooks/useEndpoints', () => ({ useEndpoints: () => ({ data: [] }) }));
vi.mock('../../../hooks/useCertificates', () => ({ useCertificates: () => ({ data: [] }) }));
vi.mock('../../../hooks/useMemberships', () => ({ useMemberships: () => ({ data: [] }) }));
vi.mock('../../../hooks/useApproval', () => ({ useApprovalStatus }));
vi.mock('../../../hooks/useAllowListFreshness', () => ({ useAllowListFreshness }));

import { TopBar } from '../TopBar';

beforeEach(() => {
  approval.data = null;
  freshness.data = undefined;
  useApprovalStatus.mockClear();
  useAllowListFreshness.mockClear();
  useCanvasStore.setState({ activeInstanceId: 'i1' });
});

describe('TopBar', () => {
  it('renders without history arrows or instance actions', () => {
    renderWithProviders(<TopBar onDownload={vi.fn()} onApproval={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /go back|go forward/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /toggle theme/i })).toBeInTheDocument();
    // Instance-only actions hidden by default, and no approval query for them.
    expect(screen.queryByRole('button', { name: /send for approval/i })).not.toBeInTheDocument();
    expect(useApprovalStatus).toHaveBeenCalledWith(null);
  });

  it('leaves the product name and the environment to the sidebar', () => {
    const { container } = renderWithProviders(
      <TopBar onDownload={vi.fn()} onApproval={vi.fn()} />,
      { lang: 'de' },
    );
    expect(container.querySelector('[data-env]')).toBeNull();
    expect(screen.queryByText('Testumgebung')).not.toBeInTheDocument();
    expect(screen.queryByText(/Allow-List-Verwaltung|DSF Management Tool/)).not.toBeInTheDocument();
  });

  it('renders download and approval actions when showInstanceActions is set', () => {
    const onDownload = vi.fn();
    const onApproval = vi.fn();
    renderWithProviders(
      <TopBar onDownload={onDownload} onApproval={onApproval} showInstanceActions />,
    );
    const send = screen.getByRole('button', { name: /send for approval/i });
    expect(send).toBeEnabled();
    expect(send).toHaveClass('btn-primary');
    fireEvent.click(screen.getByRole('button', { name: /download allow list/i }));
    expect(onDownload).toHaveBeenCalledTimes(1);
    fireEvent.click(send);
    expect(onApproval).toHaveBeenCalledTimes(1);
    expect(useApprovalStatus).toHaveBeenCalledWith('i1');
  });

  it('shows a "request running" pill that opens the running request while one is pending', () => {
    approval.data = { status: 'PENDING' };
    const onApproval = vi.fn();
    renderWithProviders(
      <TopBar onDownload={vi.fn()} onApproval={onApproval} showInstanceActions />,
    );
    expect(screen.queryByRole('button', { name: /send for approval/i })).not.toBeInTheDocument();
    const running = screen.getByRole('button', { name: /request running/i });
    expect(running).toBeEnabled();
    expect(running).toHaveTextContent('Request running');
    fireEvent.click(running);
    expect(onApproval).toHaveBeenCalledTimes(1);
  });

  it('keeps the download label visible from sm up, distinct from the filled submit CTA', () => {
    renderWithProviders(<TopBar onDownload={vi.fn()} onApproval={vi.fn()} showInstanceActions />);
    const download = screen.getByTestId('topbar-download');
    expect(download).toHaveAccessibleName(/download allow list/i);
    expect(download).not.toHaveClass('btn-primary');
    const label = screen.getByText('Download allow list', { selector: 'span' });
    expect(label).toHaveClass('sm:not-sr-only');
    expect(label).not.toHaveClass('xl:not-sr-only');
  });

  it('offers the approval action again after a rejection', () => {
    approval.data = { status: 'REJECTED' };
    renderWithProviders(<TopBar onDownload={vi.fn()} onApproval={vi.fn()} showInstanceActions />);
    expect(screen.getByRole('button', { name: /send for approval/i })).toBeEnabled();
  });

  describe('new allow-list nudge on the download button', () => {
    const outdated = { outdated: true, currentVersion: 7, lastObtainedVersion: 6 };

    it('shows the red dot, the shimmer class and the hint only while outdated', () => {
      freshness.data = outdated;
      renderWithProviders(<TopBar onDownload={vi.fn()} onApproval={vi.fn()} showInstanceActions />);
      const download = screen.getByTestId('topbar-download');
      expect(download).toHaveClass('download-nudge');
      expect(download).toHaveAttribute('data-nudge', 'true');
      expect(download).toHaveAttribute('title', expect.stringMatching(/new allow-list version 7/i));
      expect(download).toHaveAccessibleName(/download allow list.*new allow-list version 7/i);
      const dot = screen.getByTestId('topbar-download-dot');
      expect(dot).toHaveAttribute('aria-hidden', 'true');
      expect(dot).toHaveClass('bg-danger-fg');
      expect(useAllowListFreshness).toHaveBeenCalledWith('i1');
    });

    it('speaks German', () => {
      freshness.data = outdated;
      renderWithProviders(
        <TopBar onDownload={vi.fn()} onApproval={vi.fn()} showInstanceActions />,
        {
          lang: 'de',
        },
      );
      expect(screen.getByTestId('topbar-download')).toHaveAttribute(
        'title',
        'Neue Allow-List-Version 7 verfügbar – bitte herunterladen bzw. im DSF abrufen',
      );
    });

    it.each([
      ['up to date', { outdated: false, currentVersion: 7, lastObtainedVersion: 7 }],
      ['still loading', undefined],
    ])('shows nothing when %s', (_name, data) => {
      freshness.data = data;
      renderWithProviders(<TopBar onDownload={vi.fn()} onApproval={vi.fn()} showInstanceActions />);
      const download = screen.getByTestId('topbar-download');
      expect(download).not.toHaveClass('download-nudge');
      expect(download).not.toHaveAttribute('data-nudge');
      expect(screen.queryByTestId('topbar-download-dot')).toBeNull();
      expect(download).toHaveAttribute('title', 'Download allow list');
    });

    it('does not query freshness without instance actions', () => {
      renderWithProviders(<TopBar onDownload={vi.fn()} onApproval={vi.fn()} />);
      expect(useAllowListFreshness).toHaveBeenCalledWith(null);
    });

    it('keeps a static glow instead of motion under reduced motion', () => {
      const css = readFileSync(resolve(__dirname, '../../../index.css'), 'utf8');
      const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
      expect(reduced).toMatch(/\.download-nudge::after,/);
      expect(reduced).toMatch(/\.download-nudge\.download-nudge \{\s*box-shadow:/);
    });
  });
});
