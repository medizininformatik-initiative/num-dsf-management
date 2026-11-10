/**
 * IncidentTimeline.test.tsx — the event log: chain verified or broken at an
 * entry, measure results in words, comment text, the restart checklist, a
 * changed field with from and to, and the hidden reporter.
 */
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import type { IncidentEvent } from '../../../api/incidents.api';
import { IncidentTimeline } from '../IncidentTimeline';

let seq = 0;
const ev = (
  type: IncidentEvent['type'],
  details: IncidentEvent['details'],
  actor: string | null = 'admin@imi.de',
): IncidentEvent => {
  seq += 1;
  return {
    id: `e${seq}`,
    seq,
    at: '2026-11-10T09:00:00Z',
    actorEmail: actor,
    type,
    details,
    prevHash: `prev${seq}`,
    hash: `hash${seq}`,
  };
};

const events = [
  ev('REPORTED', { escalationLevel: 2 }, null),
  ev('SUSPENDED', { measure: 'REMOVE_LOGINS', removedLogins: 2, sessionsRevoked: 5 }),
  ev('MEASURE', { measure: 'WITHDRAW', versionNumber: 42 }),
  ev('COMMENT', { text: 'Called the site, server is offline' }),
  ev('SUSPENSION_LIFTED', {
    causeFixed: true,
    fixTested: true,
    releasedByTechBoard: true,
    note: 'Patched',
    versionNumber: 43,
  }),
  ev('UPDATED', { field: 'escalationLevel', from: 2, to: 3 }),
];

describe('IncidentTimeline', () => {
  it('shows a verified chain and the events in words', () => {
    renderWithProviders(
      <IncidentTimeline events={events} chain={{ valid: true, brokenAt: null }} />,
    );
    expect(screen.getByText('Hash chain verified')).toBeInTheDocument();
    expect(screen.getByText('Reporter not shown')).toBeInTheDocument();
    expect(screen.getByText('2 login certificates removed, 5 sessions ended')).toBeInTheDocument();
    expect(screen.getByText('Allow list version 42 published')).toBeInTheDocument();
    expect(screen.getByText('Called the site, server is offline')).toBeInTheDocument();
    expect(screen.getByText('The DSF Technikgremium has released the site')).toBeInTheDocument();
    expect(screen.getByText('Escalation level: 2 → 3')).toBeInTheDocument();
    expect(screen.getByText('hash3')).toBeInTheDocument();
  });

  it('flags a broken chain at its entry', () => {
    renderWithProviders(<IncidentTimeline events={events} chain={{ valid: false, brokenAt: 3 }} />);
    expect(screen.getByRole('status')).toHaveTextContent('Hash chain broken at entry 3');
  });
});
