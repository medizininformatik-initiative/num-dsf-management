/**
 * ExpiryTimeline.test.tsx — segment-state coverage for the certificate expiry
 * timeline. The component reads useCertificates(instanceId), which calls
 * api(instanceId).getCertificates(); we mock entities.api so certValidity()
 * runs against real "now" with dates built relative to it. Wide day margins
 * keep the state deterministic (thresholds 30 and 90 days, see certStatus).
 * Each entry exposes its state as data-cert-state and a translated pill; the
 * date follows the language toggle (formatDate).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { formatDate } from '../../../lib/dateUtils';
import { ExpiryTimeline } from '../ExpiryTimeline';

interface CertFixture {
  id: string;
  subject: string;
  valid_until: string;
}

let certs: CertFixture[] = [];

vi.mock('../../../api/entities.api', () => ({
  api: () => ({
    getCertificates: () => Promise.resolve({ data: { data: certs } }),
  }),
}));

// ISO date (YYYY-MM-DD) N days from now.
const isoDaysFromNow = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/** The timeline entry (li) of a certificate, found from its subject. */
const entryFor = (subject: HTMLElement): HTMLElement => {
  const entry = subject.closest('li');
  if (!entry) throw new Error('timeline entry not found for subject');
  return entry;
};

describe('ExpiryTimeline', () => {
  beforeEach(() => {
    certs = [];
  });

  it('renders nothing when there are no certificates', () => {
    certs = [];
    const { container } = renderWithProviders(<ExpiryTimeline instanceId="i1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when no instance is selected (query disabled)', () => {
    certs = [{ id: 'c1', subject: 'CN=ukm.de', valid_until: isoDaysFromNow(200) }];
    const { container } = renderWithProviders(<ExpiryTimeline instanceId={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('marks a far-future certificate as valid with its days left', async () => {
    certs = [{ id: 'c1', subject: 'CN=valid.ukm.de', valid_until: isoDaysFromNow(200) }];
    renderWithProviders(<ExpiryTimeline instanceId="i1" />);

    const entry = entryFor(
      await screen.findByText('CN=valid.ukm.de', undefined, { timeout: 4000 }),
    );

    expect(entry).toHaveAttribute('data-cert-state', 'valid');
    expect(within(entry).getByText(/^\d+ days left$/)).toHaveClass('text-success-fg');
  });

  it('marks a certificate inside the 90-day window as expiring soon (warning)', async () => {
    certs = [{ id: 'c2', subject: 'CN=soon.ukm.de', valid_until: isoDaysFromNow(60) }];
    renderWithProviders(<ExpiryTimeline instanceId="i1" />);

    const entry = entryFor(await screen.findByText('CN=soon.ukm.de', undefined, { timeout: 4000 }));

    expect(entry).toHaveAttribute('data-cert-state', 'warning');
    expect(within(entry).getByText(/^\d+ days left$/)).toHaveClass('text-warning-fg');
  });

  it('marks a certificate inside the 30-day window as critical (danger)', async () => {
    certs = [{ id: 'c4', subject: 'CN=urgent.ukm.de', valid_until: isoDaysFromNow(10) }];
    renderWithProviders(<ExpiryTimeline instanceId="i1" />);

    const entry = entryFor(
      await screen.findByText('CN=urgent.ukm.de', undefined, { timeout: 4000 }),
    );

    expect(entry).toHaveAttribute('data-cert-state', 'critical');
    expect(within(entry).getByText(/^\d+ days left$/)).toHaveClass('text-danger-fg');
  });

  it('marks an already-past certificate as expired', async () => {
    certs = [{ id: 'c3', subject: 'CN=old.ukm.de', valid_until: isoDaysFromNow(-10) }];
    renderWithProviders(<ExpiryTimeline instanceId="i1" />);

    const entry = entryFor(await screen.findByText('CN=old.ukm.de', undefined, { timeout: 4000 }));

    expect(entry).toHaveAttribute('data-cert-state', 'expired');
    expect(within(entry).getByText('Expired')).toHaveClass('text-danger-fg');
  });

  it('renders the translated header, sorts by ascending expiry and formats dates', async () => {
    const far = isoDaysFromNow(200);
    certs = [
      { id: 'far', subject: 'CN=far.ukm.de', valid_until: far },
      { id: 'near', subject: 'CN=near.ukm.de', valid_until: isoDaysFromNow(5) },
    ];
    renderWithProviders(<ExpiryTimeline instanceId="i1" />, { lang: 'de' });

    expect(
      await screen.findByRole('heading', { name: 'Zertifikats-Zeitleiste' }, { timeout: 4000 }),
    ).toBeInTheDocument();

    const subjects = screen.getAllByText(/^CN=(near|far)\.ukm\.de$/).map((el) => el.textContent);
    // Earliest expiry first: the +5-day cert precedes the +200-day cert.
    expect(subjects).toEqual(['CN=near.ukm.de', 'CN=far.ukm.de']);
    expect(screen.getByText(formatDate(far, 'de'))).toBeInTheDocument();
  });
});
