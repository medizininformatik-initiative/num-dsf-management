/**
 * Button.tsx – the app's button. Variants: primary (brand), secondary
 * (outlined surface), ghost (text only) and destructive (error colour); sizes
 * sm and md. Includes press feedback (.press-effect), a visible keyboard focus
 * ring and a disabled state shown through opacity instead of a grey fill.
 * Defaults to type="button" so it never submits a form by accident — pass
 * type="submit" explicitly. Forwards its ref, e.g. for a dialog's initial focus.
 * Dependencies: the .btn* classes in src/index.css.
 */
import { forwardRef, type ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  destructive: 'btn-destructive',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', type = 'button', className = '', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`btn press-effect ${size === 'sm' ? 'btn-sm' : 'btn-md'} ${VARIANT_CLASS[variant]} ${className}`}
      {...rest}
    />
  );
});
