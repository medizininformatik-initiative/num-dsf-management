/**
 * FreshnessBanner.test.tsx — the download dialog's top line in its three states:
 * outdated (info banner, with and without an earlier fetch), up to date (small
 * success line) and nothing while unknown.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { FreshnessBanner } from '../FreshnessBanner';
import type { AllowListFreshness } from '../../../api/entities.api';

const NOW = new Date('2026-10-12T12:00:00Z');
const base: AllowListFreshness = {
  currentVersion: 5,
  currentPublishedAt: '2026-10-12T10:00:00Z',
  lastObtainedVersion: 4,
  lastObtainedAt: '2026-10-10T12:00:00Z',
  via: 'DSF',
  outdated: true,
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('FreshnessBanner', () => {
  it('announces a new version and the last one the DSF fetched', () => {
    renderWithProviders(<FreshnessBanner freshness={base} />);
    expect(screen.getByTestId('freshness-banner')).toHaveTextContent(
      'Version 5 is new (published 2h ago). Your DSF last fetched version 4 (2d ago).',
    );
  });

  it('says so when no version was fetched yet', () => {
    renderWithProviders(
      <FreshnessBanner
        freshness={{ ...base, lastObtainedVersion: null, lastObtainedAt: null, via: null }}
      />,
    );
    expect(screen.getByTestId('freshness-banner')).toHaveTextContent(
      'Version 5 is new (published 2h ago). Your DSF has not fetched any version yet.',
    );
  });

  it('speaks German with the formal address', () => {
    renderWithProviders(<FreshnessBanner freshness={base} />, { lang: 'de' });
    expect(screen.getByTestId('freshness-banner')).toHaveTextContent(
      'Version 5 ist neu (freigegeben vor 2h). Ihr DSF hat zuletzt Version 4 abgerufen (vor 2d).',
    );
  });

  it('shows a small success line when the DSF is current', () => {
    renderWithProviders(
      <FreshnessBanner
        freshness={{
          ...base,
          lastObtainedVersion: 5,
          lastObtainedAt: '2026-10-12T11:30:00Z',
          outdated: false,
        }}
      />,
    );
    expect(screen.queryByTestId('freshness-banner')).toBeNull();
    expect(screen.getByTestId('freshness-current')).toHaveTextContent(
      'Your DSF is up to date (version 5, fetched 30m ago).',
    );
  });

  it.each<[string, AllowListFreshness | undefined]>([
    ['still loading', undefined],
    [
      'no version is published',
      { ...base, currentVersion: null, currentPublishedAt: null, outdated: false },
    ],
    [
      'not applicable (never fetched, not outdated)',
      { ...base, lastObtainedVersion: null, lastObtainedAt: null, via: null, outdated: false },
    ],
  ])('renders nothing when %s', (_name, freshness) => {
    const { container } = renderWithProviders(<FreshnessBanner freshness={freshness} />);
    expect(container).toBeEmptyDOMElement();
  });
});
