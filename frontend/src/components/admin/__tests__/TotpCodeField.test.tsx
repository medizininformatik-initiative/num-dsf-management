/**
 * TotpCodeField.test.tsx — the step-up second-factor field: digits only up to
 * six by default, a switch to a TAN (hex, upper case, up to eight) and back
 * that clears the value, and allowTan={false} without the switch.
 */
import { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { TotpCodeField } from '../TotpCodeField';

function Harness({ allowTan }: { allowTan?: boolean }) {
  const [value, setValue] = useState('');
  return <TotpCodeField label="TOTP Code" value={value} onChange={setValue} allowTan={allowTan} />;
}

describe('TotpCodeField', () => {
  it('takes digits only, at most six', () => {
    renderWithProviders(<Harness />);
    const input = screen.getByLabelText('TOTP Code') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '12ab34567' } });
    expect(input.value).toBe('123456');
  });

  it('switches to a TAN: hex, upper case, eight characters, field cleared on switch', () => {
    renderWithProviders(<Harness />);
    fireEvent.change(screen.getByLabelText('TOTP Code'), { target: { value: '123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use a TAN instead' }));

    const input = screen.getByLabelText('TAN') as HTMLInputElement;
    expect(input.value).toBe('');
    fireEvent.change(input, { target: { value: 'a1b2-c3d4e5' } });
    expect(input.value).toBe('A1B2C3D4');

    fireEvent.click(screen.getByRole('button', { name: 'Use the authenticator code instead' }));
    expect((screen.getByLabelText('TOTP Code') as HTMLInputElement).value).toBe('');
  });

  it('has no switch when allowTan is false', () => {
    renderWithProviders(<Harness allowTan={false} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
