/**
 * RequestCardRisk.test.tsx — the risk banner at the top of the pending request card: level pill
 * with text (not colour only), first-request marker, the compact verdict text in German and
 * English, and no banner when the backend sent no assessment.
 * Dependencies: RequestCard, useI18n, renderWithProviders; useAdmin and sonner are mocked.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import type { RiskAssessment } from '../../../api/admin.api';

vi.mock('../../../hooks/useAdmin', () => ({
  useApproveRequest: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRejectRequest: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { RequestCard } from '../RequestCard';

function card(risk: RiskAssessment | null | undefined) {
  return (
    <RequestCard
      request={{
        id: 'req-1',
        status: 'PENDING',
        submitted_at: new Date(Date.now() - 86400_000).toISOString(),
        snapshot_json: { organization: { name: 'Uniklinik Münster', identifier: 'ukm.de' } },
        signatures: [],
        risk,
      }}
      meEmail="op@imi.de"
    />
  );
}

const renewal: RiskAssessment = {
  level: 'LOW',
  score: -1,
  firstRequest: false,
  findings: [
    { code: 'CERT_RENEWAL', severity: 'info', weight: -1, params: { cn: 'dsf.ukm.de', days: 12 } },
  ],
};

const takeover: RiskAssessment = {
  level: 'HIGH',
  score: 8,
  firstRequest: false,
  findings: [
    { code: 'TAKEOVER_PATTERN', severity: 'high', weight: 4, params: {} },
    { code: 'CONTACT_DATA_CHANGED', severity: 'medium', weight: 2, params: {} },
  ],
};

describe('RequestCard risk banner', () => {
  it('shows a low-risk pill and the renewal sentence', () => {
    renderWithProviders(card(renewal), { lang: 'de' });
    const group = screen.getByRole('group', { name: 'Auffälligkeits-Bewertung' });
    expect(within(group).getByText('Unauffällig')).toBeInTheDocument();
    expect(
      within(group).getByText(
        'Routine-Verlängerung von dsf.ukm.de, altes Zertifikat läuft in 12 Tagen ab, gleiche CA.',
      ),
    ).toBeInTheDocument();
  });

  it('shows a suspicious pill with the takeover wording', () => {
    renderWithProviders(card(takeover), { lang: 'de' });
    const group = screen.getByRole('group', { name: 'Auffälligkeits-Bewertung' });
    expect(within(group).getByText('Auffällig')).toBeInTheDocument();
    expect(within(group).getByText(/Übernahme-Muster/)).toBeInTheDocument();
  });

  it('marks a first request with the neutral pill', () => {
    renderWithProviders(
      card({
        level: 'LOW',
        score: 0,
        firstRequest: true,
        findings: [{ code: 'FIRST_REQUEST', severity: 'info', weight: 0, params: {} }],
      }),
      { lang: 'de' },
    );
    const group = screen.getByRole('group', { name: 'Auffälligkeits-Bewertung' });
    expect(within(group).getByText('Erstantrag')).toBeInTheDocument();
    expect(within(group).queryByText('Unauffällig')).not.toBeInTheDocument();
  });

  it('renders in English', () => {
    renderWithProviders(card(takeover), { lang: 'en' });
    const group = screen.getByRole('group', { name: 'Request risk assessment' });
    expect(within(group).getByText('Suspicious')).toBeInTheDocument();
  });

  it('renders no banner without an assessment', () => {
    renderWithProviders(card(null), { lang: 'de' });
    expect(screen.queryByRole('group', { name: 'Auffälligkeits-Bewertung' })).toBeNull();
    renderWithProviders(card(undefined), { lang: 'de' });
    expect(screen.queryByRole('group', { name: 'Auffälligkeits-Bewertung' })).toBeNull();
  });
});
