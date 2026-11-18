/**
 * SimpleView.test.tsx — the simplified view of the five entity cards: each card hides its
 * detail fields, warnings stay visible (unverified e-mail, IP changes, expired or untrusted
 * certificate), and the per-card "Show details" toggle expands only its own card.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { useCanvasViewStore } from '../../../stores/canvasView.store';

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

const state = vi.hoisted(() => ({
  contacts: [] as unknown[],
  endpoints: [] as unknown[],
  certs: [] as unknown[],
  history: [] as unknown[],
}));

const query = (data: unknown) => ({ data, isLoading: false, isError: false, refetch: vi.fn() });
const mutation = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };

vi.mock('../../../hooks/useContacts', () => ({
  useContacts: () => query(state.contacts),
  useDeleteContact: () => mutation,
}));
vi.mock('../../../hooks/useEndpoints', () => ({
  useEndpoints: () => query(state.endpoints),
  useDeleteEndpoint: () => mutation,
}));
vi.mock('../../../hooks/useMemberships', () => ({
  useMemberships: () =>
    query([
      { id: 'm1', parent_organization: 'num.de', endpoint_id: 'fhir.ukm.de', roles: ['DIC'] },
    ]),
  useDeleteMembership: () => mutation,
}));
vi.mock('../../../hooks/useCertificates', () => ({
  useCertificates: () => query(state.certs),
  useDeleteCertificate: () => mutation,
}));
vi.mock('../../../hooks/useOrganization', () => ({
  useOrganization: () =>
    query({
      identifier: 'ukm.de',
      name: 'Klinik Eins',
      email: 'it@klinik-eins.example.de',
      active: 1,
      city: 'Münster',
      country_code: 'DE',
      address_line: 'Hauptstr. 1',
    }),
  useUpdateOrganization: () => mutation,
}));
vi.mock('../../../hooks/useApproval', () => ({
  useApprovalStatus: () => ({ data: { status: 'APPROVED' } }),
  useApprovalHistory: () => ({ data: state.history }),
}));
vi.mock('../../../hooks/useMe', () => ({
  useMe: () => ({ data: { email: 'a@b.de', isAdmin: true } }),
}));
vi.mock('../../../hooks/useLoginCertificates', () => ({
  useLoginCertificates: () => ({ data: [] }),
  useEnableLoginCertificate: () => mutation,
  useRemoveLoginCertificate: () => mutation,
}));

import { OrganizationCard } from '../OrganizationCard';
import { ContactsCard } from '../ContactsCard';
import { EndpointsCard } from '../EndpointsCard';
import { MembershipsCard } from '../MembershipsCard';
import { CertificatesCard } from '../CertificatesCard';

const endpoint = {
  identifier: 'fhir.ukm.de',
  name: 'UKM FHIR',
  address: 'https://fhir.ukm.de/fhir',
  ipAddresses: [{ id: 'ip1', ip: '10.0.0.2', isFhir: true, isBpe: false }],
};
const goodCert = {
  id: 'c1',
  subject: 'CN=ukm.de',
  thumbprint: 'AB12',
  thumbprintSha512: 'a1'.repeat(64),
  valid_until: inDays(200),
  issuerDn: 'CN=GEANT TLS RSA 1',
  issuerTrusted: true,
};

beforeEach(() => {
  useCanvasViewStore.setState({ choice: 'simple' });
  state.contacts = [
    { id: 'k1', name: 'Dr. Test', email: 'd@ukm.de', types: ['MEDIC'], email_validated: true },
  ];
  state.endpoints = [endpoint];
  state.certs = [goodCert];
  state.history = [];
});

describe('simplified view: Organization', () => {
  it('shows name, identifier, status and approval, and hides address and e-mail', () => {
    renderWithProviders(<OrganizationCard instanceId="i1" />);
    expect(screen.getByText('Klinik Eins')).toBeInTheDocument();
    expect(screen.getByText('ukm.de')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
    expect(screen.queryByText('it@klinik-eins.example.de')).not.toBeInTheDocument();
    expect(screen.queryByText('Hauptstr. 1')).not.toBeInTheDocument();
    expect(screen.queryByText('Shared with')).not.toBeInTheDocument();
  });
});

describe('simplified view: Contacts', () => {
  it('shows name and role badges, hides the verified pill', () => {
    renderWithProviders(<ContactsCard instanceId="i1" />);
    expect(screen.getByText('Dr. Test')).toBeInTheDocument();
    expect(screen.getByText('MeDIC contact')).toBeInTheDocument();
    expect(screen.queryByText('d@ukm.de')).not.toBeInTheDocument();
    expect(screen.queryByText('Email verified')).not.toBeInTheDocument();
  });

  it('keeps a warning for an unverified e-mail without the resend button', () => {
    state.contacts = [
      { id: 'k1', name: 'Dr. Test', email: 'd@ukm.de', types: [], email_validated: false },
    ];
    renderWithProviders(<ContactsCard instanceId="i1" />);
    expect(screen.getByLabelText('Email not verified')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /resend/i })).not.toBeInTheDocument();
  });
});

describe('simplified view: Endpoints', () => {
  it('shows name and identifier, hides address and IPs', () => {
    renderWithProviders(<EndpointsCard instanceId="i1" />);
    expect(screen.getByText('UKM FHIR')).toBeInTheDocument();
    expect(screen.getByText('fhir.ukm.de')).toBeInTheDocument();
    expect(screen.queryByText('https://fhir.ukm.de/fhir')).not.toBeInTheDocument();
    expect(screen.queryByText('10.0.0.2')).not.toBeInTheDocument();
  });

  it('keeps a compact pill when IPs changed since the last approval', () => {
    state.history = [{ status: 'APPROVED', approved_ips: ['10.0.0.1'] }];
    renderWithProviders(<EndpointsCard instanceId="i1" />);
    expect(screen.getByText('IP changes')).toBeInTheDocument();
    expect(screen.queryByText('IP changes since the last approval')).not.toBeInTheDocument();
  });
});

describe('simplified view: Memberships', () => {
  it('shows parent organization and roles, hides the endpoint link', () => {
    renderWithProviders(<MembershipsCard instanceId="i1" />);
    expect(screen.getByText('num.de')).toBeInTheDocument();
    expect(screen.getByText('DIC')).toBeInTheDocument();
    expect(screen.queryByText('fhir.ukm.de')).not.toBeInTheDocument();
  });
});

describe('simplified view: Certificates', () => {
  it('shows subject and validity pill, hides fingerprints, issuer and the login switch', () => {
    renderWithProviders(<CertificatesCard instanceId="i1" />);
    expect(screen.getByText('CN=ukm.de')).toBeInTheDocument();
    expect(screen.getByText('Valid')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /renew/i })).toBeInTheDocument();
    expect(screen.queryByText('Issuer')).not.toBeInTheDocument();
    expect(screen.queryByText('More fingerprints')).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('keeps the expired and the untrusted-issuer warnings', () => {
    state.certs = [{ ...goodCert, valid_until: inDays(-5), issuerTrusted: false }];
    renderWithProviders(<CertificatesCard instanceId="i1" />);
    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(screen.getByText('No DSF CA')).toBeInTheDocument();
    expect(screen.queryByText(/refuse certificates/i)).not.toBeInTheDocument();
  });
});

describe('per-card details toggle', () => {
  it('expands only its own card and collapses again', async () => {
    renderWithProviders(
      <>
        <OrganizationCard instanceId="i1" />
        <ContactsCard instanceId="i1" />
      </>,
    );
    const toggles = screen.getAllByRole('button', { name: 'Show details' });
    expect(toggles).toHaveLength(2);

    await userEvent.click(toggles[0]);
    expect(await screen.findByText('it@klinik-eins.example.de')).toBeInTheDocument();
    expect(screen.queryByText('d@ukm.de')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide details' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('is not offered in the detailed view', () => {
    useCanvasViewStore.setState({ choice: 'detailed' });
    renderWithProviders(<OrganizationCard instanceId="i1" />);
    expect(screen.queryByRole('button', { name: /details/i })).not.toBeInTheDocument();
    expect(screen.getByText('it@klinik-eins.example.de')).toBeInTheDocument();
  });
});
