/**
 * ImiLogo.test.tsx – the logo swaps to the white-text variant in dark mode.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ImiLogo, IMI_LOGO_DARK, IMI_LOGO_LIGHT } from '../ImiLogo';
import { useThemeStore } from '../../../stores/theme.store';

describe('ImiLogo', () => {
  afterEach(() => useThemeStore.setState({ dark: false }));

  it('renders the light variant by default', () => {
    useThemeStore.setState({ dark: false });
    render(<ImiLogo />);
    expect(screen.getByAltText('Institute of Medical Informatics')).toHaveAttribute(
      'src',
      IMI_LOGO_LIGHT,
    );
  });

  it('renders the white-text variant in dark mode', () => {
    useThemeStore.setState({ dark: true });
    render(<ImiLogo />);
    expect(screen.getByAltText('Institute of Medical Informatics')).toHaveAttribute(
      'src',
      IMI_LOGO_DARK,
    );
  });
});
