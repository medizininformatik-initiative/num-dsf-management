/**
 * Select.tsx – Native <select> in the app's input style: same border, fill,
 * focus ring, invalid/disabled states and dark mode as the text fields, with
 * the browser arrow replaced by a chevron (appearance-none). Forwards its ref
 * and all props to the <select> (react-hook-form's register and FormField's
 * cloned id/aria props keep working). `pill` gives the rounded filter-bar look.
 * Dependencies: ui/Icon, modals/FormField (fieldSurfaceClass).
 */
import { forwardRef, type SelectHTMLAttributes } from 'react';
import { Icon } from './Icon';
import { fieldSurfaceClass } from '../modals/FormField';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** Fully rounded, compact look for filter bars. */
  pill?: boolean;
  /** Classes for the wrapper (width, margin). */
  wrapperClassName?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { pill = false, wrapperClassName = '', className = '', children, ...rest },
  ref,
) {
  const shape = pill
    ? 'min-h-[40px] rounded-full py-2 pl-3.5 pr-9 press-effect'
    : 'w-full py-2 pl-3 pr-9';
  return (
    <div className={`relative ${pill ? 'inline-block' : 'block'} ${wrapperClassName}`.trim()}>
      <select
        ref={ref}
        {...rest}
        className={`${fieldSurfaceClass} ${shape} cursor-pointer appearance-none text-sm ${className}`.trim()}
      >
        {children}
      </select>
      <Icon
        name="expand_more"
        size={18}
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)]"
      />
    </div>
  );
});
