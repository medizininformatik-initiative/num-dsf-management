/**
 * ImiLogo.tsx – IMI (Institute of Medical Informatics) logo that swaps to a
 * white-text variant in dark mode.
 * Dependencies: stores/theme.store
 */
import { useThemeStore } from '../../stores/theme.store';

export const IMI_LOGO_LIGHT = '/logos/IMI-Logo-grad-eng.png';
export const IMI_LOGO_DARK = '/logos/IMI-Logo-grad-eng-dark.png';

export function ImiLogo({
  alt = 'Institute of Medical Informatics',
  className = '',
  style,
}: {
  alt?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const dark = useThemeStore((s) => s.dark);
  return (
    <img
      src={dark ? IMI_LOGO_DARK : IMI_LOGO_LIGHT}
      alt={alt}
      // Height via className/style; width stays auto so the logo is never distorted.
      className={`block w-auto ${className}`}
      style={style}
    />
  );
}
