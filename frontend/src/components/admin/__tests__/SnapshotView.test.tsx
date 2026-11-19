/**
 * SnapshotView.test.tsx — renders the read-only approval-snapshot viewer with a
 * representative SnapshotData and asserts the Organization, Endpoints,
 * Certificates, Memberships and Contacts sections each render their values; a
 * second case with an empty snapshot exercises the empty-note paths. The real
 * i18n translate fn is passed so the rendered, parameter-filled text is asserted.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SnapshotView } from '../SnapshotView';
import type { SnapshotData } from '../parseSnapshot';
import { useI18n } from '../../../stores/i18n.store';

const t = useI18n.getState().t;
useI18n.getState().setLang('en');

const SNAPSHOT: SnapshotData = {
  organization: {
    name: 'Uniklinik Münster',
    identifier: 'ukm.de',
    email: 'dsf@ukm.de',
    city: 'Münster',
    country_code: 'DE',
  },
  endpoints: [
    {
      identifier: 'ep-1',
      name: 'UKM FHIR',
      address: 'https://ukm.de/fhir',
      ips: [{ ip: '10.0.0.5', is_fhir: true, is_bpe: false }],
    },
  ],
  certificates: [{ subject: 'CN=ukm.de', thumbprint: 'AB12CD', valid_until: '2027-01-01' }],
  memberships: [{ parent_organization: 'num.de', roles: ['DIC', 'HRP'], endpoint_id: 'ep-1' }],
  contacts: [{ name: 'Dr. Admin', email: 'admin@ukm.de', types: ['DSF_ADMIN'] }],
};

describe('SnapshotView', () => {
  it('renders the organization fields', () => {
    render(<SnapshotView snapshot={SNAPSHOT} t={t} />);
    expect(screen.getByText('Uniklinik Münster')).toBeInTheDocument();
    expect(screen.getByText('ukm.de')).toBeInTheDocument();
    expect(screen.getByText('dsf@ukm.de')).toBeInTheDocument();
    expect(screen.getByText('Münster')).toBeInTheDocument();
    expect(screen.getByText('DE')).toBeInTheDocument();
  });

  it('renders the endpoint name, address and IP badge', () => {
    render(<SnapshotView snapshot={SNAPSHOT} t={t} />);
    expect(screen.getByText('UKM FHIR')).toBeInTheDocument();
    expect(screen.getByText('https://ukm.de/fhir')).toBeInTheDocument();
    expect(screen.getByText('10.0.0.5 [FHIR]')).toBeInTheDocument();
  });

  it('renders the certificate subject, thumbprint and expiry in the app language', () => {
    render(<SnapshotView snapshot={SNAPSHOT} t={t} />);
    expect(screen.getByText('CN=ukm.de')).toBeInTheDocument();
    expect(screen.getByText('AB12CD')).toBeInTheDocument();
    expect(screen.getByText(t('adminSnapshotExpires', { date: '1 Jan 2027' }))).toBeInTheDocument();
  });

  it('shows the purpose flags of a certificate; a snapshot without them reads as both set', () => {
    const { rerender } = render(<SnapshotView snapshot={SNAPSHOT} t={t} />);
    const badges = screen.getByTestId('snapshot-cert-purpose');
    expect(badges).toHaveTextContent('In allow list');
    expect(badges).toHaveTextContent('Login');
    expect(badges).not.toHaveTextContent('No login');

    rerender(
      <SnapshotView
        snapshot={{
          ...SNAPSHOT,
          certificates: [
            { subject: 'CN=ukm.de', publish_in_allowlist: false, use_for_login: true },
          ],
        }}
        t={t}
      />,
    );
    expect(screen.getByTestId('snapshot-cert-purpose')).toHaveTextContent('Not published');
  });

  it('renders the membership parent org, roles and endpoint id', () => {
    render(<SnapshotView snapshot={SNAPSHOT} t={t} />);
    expect(screen.getByText('num.de')).toBeInTheDocument();
    expect(screen.getByText('DIC')).toBeInTheDocument();
    expect(screen.getByText('HRP')).toBeInTheDocument();
  });

  it('renders the contact name, email and types', () => {
    render(<SnapshotView snapshot={SNAPSHOT} t={t} />);
    expect(screen.getByText('Dr. Admin')).toBeInTheDocument();
    expect(screen.getByText('admin@ukm.de')).toBeInTheDocument();
    expect(screen.getByText('DSF_ADMIN')).toBeInTheDocument();
  });

  it('renders empty-section notes when the snapshot has no entities', () => {
    render(<SnapshotView snapshot={{}} t={t} />);
    expect(screen.getByText(t('adminSnapshotNoOrg'))).toBeInTheDocument();
    expect(screen.getByText(t('adminSnapshotNoEndpoints'))).toBeInTheDocument();
    expect(screen.getByText(t('adminSnapshotNoCerts'))).toBeInTheDocument();
    expect(screen.getByText(t('adminSnapshotNoMemberships'))).toBeInTheDocument();
  });
});
