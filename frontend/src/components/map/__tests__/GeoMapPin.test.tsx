import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { GeoMapPin } from '../GeoMapPin';
import type { MapOrganization } from '../../../api/network.api';

const org: MapOrganization = {
  identifier: 'ukm.de',
  name: 'Uni Klinikum Muenster',
  active: true,
  city: 'Muenster',
  country_code: 'DE',
  cert_status: 'VALID',
  endpoints: [],
  memberships: [],
};

describe('GeoMapPin', () => {
  it('renders the org initials as a label', () => {
    renderWithProviders(
      <svg>
        <GeoMapPin
          org={org}
          x={100}
          y={120}
          isHovered={false}
          isSelected={false}
          isUnknown={false}
          onSelect={vi.fn()}
          onHover={vi.fn()}
        />
      </svg>,
    );
    // "Uni Klinikum Muenster" -> first letter of first two tokens -> "UK"
    expect(screen.getByText('UK')).toBeInTheDocument();
  });

  it('fires onSelect with the org identifier on click', () => {
    const onSelect = vi.fn();
    renderWithProviders(
      <svg>
        <GeoMapPin
          org={org}
          x={100}
          y={120}
          isHovered={false}
          isSelected={false}
          isUnknown={false}
          onSelect={onSelect}
          onHover={vi.fn()}
        />
      </svg>,
    );
    fireEvent.click(screen.getByText('UK'));
    expect(onSelect).toHaveBeenCalledWith('ukm.de');
  });

  it('renders the unknown-city "?" indicator when isUnknown', () => {
    renderWithProviders(
      <svg>
        <GeoMapPin
          org={org}
          x={100}
          y={120}
          isHovered={false}
          isSelected={false}
          isUnknown
          onSelect={vi.fn()}
          onHover={vi.fn()}
        />
      </svg>,
    );
    expect(screen.getByText('?')).toBeInTheDocument();
  });

  it('names the pin with its certificate state (and inactivity) and marks the selection', () => {
    renderWithProviders(
      <svg>
        <GeoMapPin
          org={{ ...org, active: false, cert_status: 'EXPIRED' }}
          x={100}
          y={120}
          isHovered={false}
          isSelected
          isUnknown={false}
          onSelect={vi.fn()}
          onHover={vi.fn()}
        />
      </svg>,
    );
    const pin = screen.getByRole('button', {
      name: 'Uni Klinikum Muenster, inactive, certificate: Expired',
    });
    expect(pin).toHaveAttribute('aria-current', 'true');
  });

  it('reports hover on keyboard focus as well as on the pointer', () => {
    const onHover = vi.fn();
    renderWithProviders(
      <svg>
        <GeoMapPin
          org={org}
          x={100}
          y={120}
          isHovered={false}
          isSelected={false}
          isUnknown={false}
          onSelect={vi.fn()}
          onHover={onHover}
        />
      </svg>,
    );
    const pin = screen.getByRole('button');
    fireEvent.focus(pin);
    expect(onHover).toHaveBeenLastCalledWith('ukm.de');
    fireEvent.blur(pin);
    expect(onHover).toHaveBeenLastCalledWith(null);
  });

  it('is hidden from assistive technology and the tab order while leaving', () => {
    const { container } = renderWithProviders(
      <svg>
        <GeoMapPin
          org={org}
          x={100}
          y={120}
          isHovered={false}
          isSelected={false}
          isUnknown={false}
          leaving
          onSelect={vi.fn()}
          onHover={vi.fn()}
        />
      </svg>,
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.querySelector('.map-marker')).not.toHaveAttribute('tabindex');
    expect(container.querySelector('.map-animate-node-out')).not.toBeNull();
  });
});
