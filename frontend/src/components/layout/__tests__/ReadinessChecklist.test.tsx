/**
 * ReadinessChecklist.test.tsx — covers the right-panel readiness checklist. The
 * five entity hooks are mocked (vi.hoisted + vi.mock) so each test feeds exact
 * .data into deriveReadiness without touching the network: every step
 * satisfied -> the ready summary; a missing step -> the open summary and an
 * actionable row that highlights and scrolls to its card; a contact without
 * the MEDIC role does not count; each status icon has a text alternative.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { useCanvasStore } from '../../../stores/canvas.store';

const useOrganization = vi.hoisted(() => vi.fn());
const useContacts = vi.hoisted(() => vi.fn());
const useEndpoints = vi.hoisted(() => vi.fn());
const useCertificates = vi.hoisted(() => vi.fn());
const useMemberships = vi.hoisted(() => vi.fn());

vi.mock('../../../hooks/useOrganization', () => ({ useOrganization }));
vi.mock('../../../hooks/useContacts', () => ({ useContacts }));
vi.mock('../../../hooks/useEndpoints', () => ({ useEndpoints }));
vi.mock('../../../hooks/useCertificates', () => ({ useCertificates }));
vi.mock('../../../hooks/useMemberships', () => ({ useMemberships }));

import { ReadinessChecklist } from '../ReadinessChecklist';

// A valid_until far in the future so the certificate step always reads as done.
const FAR_FUTURE = '2099-01-01';

beforeEach(() => {
  vi.clearAllMocks();
  useCanvasStore.setState({ highlightedEntity: null });
  useOrganization.mockReturnValue({ data: { active: true } });
  useContacts.mockReturnValue({ data: [{ id: 'ct1', types: ['MEDIC'] }] });
  useEndpoints.mockReturnValue({ data: [{ identifier: 'fhir.ukm.de' }] });
  useCertificates.mockReturnValue({ data: [{ id: 'c1', valid_until: FAR_FUTURE }] });
  useMemberships.mockReturnValue({ data: [{ id: 'm1' }] });
});

describe('ReadinessChecklist', () => {
  it('shows the ready summary when every step is satisfied', () => {
    renderWithProviders(<ReadinessChecklist instanceId="i1" />);
    expect(screen.getByText('Ready to submit')).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: 'Done' })).toHaveLength(5);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows the open summary with one step left when endpoints are empty', () => {
    useEndpoints.mockReturnValue({ data: [] });
    renderWithProviders(<ReadinessChecklist instanceId="i1" />);
    expect(screen.getByText('1 step(s) left')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Missing' })).toBeInTheDocument();
  });

  it('does not count a contact without the MEDIC role', () => {
    useContacts.mockReturnValue({ data: [{ id: 'ct1', types: ['DSF_ADMIN'] }] });
    renderWithProviders(<ReadinessChecklist instanceId="i1" />);
    expect(screen.getByRole('button', { name: /Missing MEDIC contact/ })).toBeInTheDocument();
  });

  it('jumps to the endpoints card when its open row is clicked', () => {
    useEndpoints.mockReturnValue({ data: [] });
    const card = document.createElement('div');
    card.id = 'card-endpoints';
    card.scrollIntoView = vi.fn();
    document.body.appendChild(card);
    const highlightSpy = vi.spyOn(useCanvasStore.getState(), 'highlightEntity');
    renderWithProviders(<ReadinessChecklist instanceId="i1" />);

    const button = screen.getByRole('button', { name: /Endpoint/ });
    fireEvent.click(button);

    expect(highlightSpy).toHaveBeenCalledWith('endpoints');
    expect(useCanvasStore.getState().highlightedEntity).toBe('endpoints');
    expect(card.scrollIntoView).toHaveBeenCalled();
    card.remove();
  });
});
