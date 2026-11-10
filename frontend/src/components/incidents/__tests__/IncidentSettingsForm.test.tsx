/**
 * IncidentSettingsForm.test.tsx — only changed fields are sent; raising the
 * level to 2 or 3 calls onLevelRaised; an empty Zulip link removes it and a
 * plain http link is refused before any request. incidents.api is mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/renderWithProviders';
import type { Incident } from '../../../api/incidents.api';

const { updateMock } = vi.hoisted(() => ({ updateMock: vi.fn() }));
vi.mock('../../../api/incidents.api', () => ({ incidentsApi: { update: updateMock } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { IncidentSettingsForm } from '../IncidentSettingsForm';

const incident = {
  id: 'i1',
  escalationLevel: 1,
  detectedAt: '2026-11-09T09:00:00Z',
  zulipUrl: 'https://zulip.example.org/#narrow/1',
} as Incident;

beforeEach(() => {
  vi.clearAllMocks();
  updateMock.mockResolvedValue({ data: { data: incident } });
});

describe('IncidentSettingsForm', () => {
  it('sends only the raised level and offers the suspension', async () => {
    const onLevelRaised = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<IncidentSettingsForm incident={incident} onLevelRaised={onLevelRaised} />);
    await user.selectOptions(screen.getByLabelText(/Escalation level/), '3');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith('i1', { escalationLevel: 3 }));
    await waitFor(() => expect(onLevelRaised).toHaveBeenCalledWith(3));
  });

  it('removes the Zulip link when emptied', async () => {
    const user = userEvent.setup();
    renderWithProviders(<IncidentSettingsForm incident={incident} />);
    await user.clear(screen.getByLabelText(/Zulip/));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith('i1', { zulipUrl: null }));
  });

  it('refuses a plain http link', async () => {
    const user = userEvent.setup();
    renderWithProviders(<IncidentSettingsForm incident={incident} />);
    await user.clear(screen.getByLabelText(/Zulip/));
    await user.type(screen.getByLabelText(/Zulip/), 'http://zulip.example.org');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Must be an https:// link')).toBeInTheDocument();
    expect(updateMock).not.toHaveBeenCalled();
  });
});
