/**
 * OnboardingWizard.test.tsx — the wizard follows the shared readiness rule:
 * an expired certificate, a non-MEDIC contact or an inactive organization keep
 * their step open, only a PENDING or APPROVED request completes "Submit", the
 * wizard hides once all six steps are done, and an open step opens the modal
 * that fixes it. All data hooks are mocked per test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { useModals } from '../../../hooks/useModals';

const data = vi.hoisted(() => ({
  org: null as Record<string, unknown> | null,
  contacts: [] as Record<string, unknown>[],
  endpoints: [] as Record<string, unknown>[],
  certs: [] as Record<string, unknown>[],
  memberships: [] as Record<string, unknown>[],
  approval: null as Record<string, unknown> | null,
}));

vi.mock('../../../hooks/useOrganization', () => ({
  useOrganization: () => ({ data: data.org }),
}));
vi.mock('../../../hooks/useContacts', () => ({
  useContacts: () => ({ data: data.contacts }),
}));
vi.mock('../../../hooks/useEndpoints', () => ({
  useEndpoints: () => ({ data: data.endpoints }),
}));
vi.mock('../../../hooks/useCertificates', () => ({
  useCertificates: () => ({ data: data.certs }),
}));
vi.mock('../../../hooks/useMemberships', () => ({
  useMemberships: () => ({ data: data.memberships }),
}));
vi.mock('../../../hooks/useApproval', () => ({
  useApprovalStatus: () => ({ data: data.approval }),
}));

import { OnboardingWizard } from '../OnboardingWizard';

function seedComplete() {
  data.org = { name: 'Uniklinik', identifier: 'ukm.de', active: 1 };
  data.contacts = [{ id: 'c1', types: ['MEDIC'] }];
  data.endpoints = [{ identifier: 'fhir.ukm.de' }];
  data.certs = [{ id: 'cert1', valid_until: '2999-01-01' }];
  data.memberships = [{ id: 'm1' }];
  data.approval = { status: 'PENDING' };
}

beforeEach(() => {
  seedComplete();
  useModals.setState({ open: null, editId: null });
});

describe('OnboardingWizard', () => {
  it('renders the header and the steps when onboarding is incomplete', () => {
    data.contacts = [];
    data.endpoints = [];
    data.certs = [];
    data.memberships = [];
    data.approval = null;
    renderWithProviders(<OnboardingWizard instanceId="i1" />);
    expect(screen.getByRole('heading', { name: /getting started/i })).toBeInTheDocument();
    expect(screen.getByText('Active organization')).toBeInTheDocument();
    expect(screen.getByText('1/6 complete')).toBeInTheDocument();
  });

  it('hides once every data step is done and a request is pending', () => {
    const { container } = renderWithProviders(<OnboardingWizard instanceId="i1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('does not count a rejected request as submitted', () => {
    data.approval = { status: 'REJECTED' };
    renderWithProviders(<OnboardingWizard instanceId="i1" />);
    expect(screen.getByText('5/6 complete')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument();
  });

  it('keeps the certificate step open for an expired-only certificate', () => {
    data.certs = [{ id: 'cert1', valid_until: '2000-01-01' }];
    renderWithProviders(<OnboardingWizard instanceId="i1" />);
    expect(screen.getByText('5/6 complete')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Missing Valid certificate/ })).toBeInTheDocument();
  });

  it('keeps the contact step open without a MEDIC contact and the org step for an inactive org', () => {
    data.contacts = [{ id: 'c1', types: ['DSF_ADMIN'] }];
    data.org = { name: 'Uniklinik', identifier: 'ukm.de', active: 0 };
    renderWithProviders(<OnboardingWizard instanceId="i1" />);
    expect(screen.getByText('4/6 complete')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /MEDIC contact/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Active organization/ })).toBeInTheDocument();
  });

  it('opens the modal that fixes an open step', () => {
    data.endpoints = [];
    renderWithProviders(<OnboardingWizard instanceId="i1" />);
    fireEvent.click(screen.getByRole('button', { name: /Endpoint/ }));
    expect(useModals.getState().open).toBe('endpoint-add');
  });

  it('opens the approval modal from the submit step', () => {
    data.approval = null;
    renderWithProviders(<OnboardingWizard instanceId="i1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(useModals.getState().open).toBe('approval');
  });
});

describe('OnboardingWizard motion', () => {
  const stepItem = (label: string) => screen.getByText(label).closest('li') as HTMLElement;

  it('staggers the steps in and collapses completed steps to their check', () => {
    data.endpoints = [];
    renderWithProviders(<OnboardingWizard instanceId="i1" />);
    const done = stepItem('Active organization');
    expect(done).toHaveAttribute('data-done', 'true');
    expect(done).toHaveClass('grow-0', 'animate-list-item-in');
    expect(screen.getByText('Active organization')).toHaveClass('sr-only');
    expect(stepItem('Endpoint')).toHaveClass('grow');
    // Done before the wizard appeared: no check pop.
    expect(done.querySelector('.animate-check-in')).toBeNull();
  });

  it('pops the check and springs the progress bar when a step completes on screen', () => {
    data.endpoints = [];
    data.approval = null;
    const { rerender } = renderWithProviders(<OnboardingWizard instanceId="i1" />);
    expect(screen.getByTestId('onboarding-progress')).toHaveStyle({ width: `${(4 / 6) * 100}%` });

    data.endpoints = [{ identifier: 'fhir.ukm.de' }];
    rerender(<OnboardingWizard instanceId="i1" />);

    expect(stepItem('Endpoint').querySelector('.animate-check-in')).not.toBeNull();
    const bar = screen.getByTestId('onboarding-progress');
    expect(bar).toHaveClass('ease-spring');
    expect(bar).toHaveStyle({ width: `${(5 / 6) * 100}%` });
  });

  it('collapses away once the last step is done, then unmounts', async () => {
    data.approval = null;
    const { rerender, container } = renderWithProviders(<OnboardingWizard instanceId="i1" />);
    expect(screen.getByRole('heading', { name: /getting started/i })).toBeInTheDocument();

    data.approval = { status: 'PENDING' };
    rerender(<OnboardingWizard instanceId="i1" />);

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper).toHaveAttribute('data-state', 'closed');
    expect(wrapper.className).toContain('animate-expand-out');
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
