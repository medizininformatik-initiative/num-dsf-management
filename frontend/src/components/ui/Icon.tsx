/**
 * Icon.tsx – a Material Symbols (outlined) glyph, replacing hand-written
 * `<span className="material-symbols-outlined">name</span>` markup.
 * Decorative by default (aria-hidden); pass `label` when the icon alone carries
 * meaning, which switches it to role="img" with that accessible name.
 * translate="no" stops browser translation from rewriting the ligature name.
 * Dependencies: the Material Symbols font imported in src/index.css.
 */
import type { CSSProperties, HTMLAttributes } from 'react';

export interface IconProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** Ligature name, e.g. "close" or "check_circle". */
  name: string;
  /** Font size in px; inherits the surrounding font size when omitted. */
  size?: number;
  /** Filled variant (FILL axis of the variable font). */
  filled?: boolean;
  /** Accessible name. Omit for decorative icons next to visible text. */
  label?: string;
}

export function Icon({ name, size, filled, label, className = '', style, ...rest }: IconProps) {
  const iconStyle: CSSProperties = { ...style };
  if (size) iconStyle.fontSize = size;
  if (filled) iconStyle.fontVariationSettings = "'FILL' 1";
  return (
    <span
      {...rest}
      className={`material-symbols-outlined select-none ${className}`}
      style={iconStyle}
      translate="no"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      {name}
    </span>
  );
}
