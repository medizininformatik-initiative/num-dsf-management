/**
 * Select.test.tsx – the styled select forwards props and ref, renders the
 * chevron instead of the native arrow and stays operable.
 */
import { describe, it, expect, vi } from 'vitest';
import { createRef } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Select } from '../Select';

describe('Select', () => {
  it('renders a native select with appearance-none and a chevron', () => {
    const { container } = render(
      <Select aria-label="Topic" defaultValue="b">
        <option value="a">A</option>
        <option value="b">B</option>
      </Select>,
    );
    const select = screen.getByRole('combobox', { name: 'Topic' });
    expect(select).toHaveValue('b');
    expect(select.className).toContain('appearance-none');
    expect(container.querySelector('.material-symbols-outlined')).toBeInTheDocument();
  });

  it('forwards onChange and the ref to the select', () => {
    const ref = createRef<HTMLSelectElement>();
    const onChange = vi.fn();
    render(
      <Select aria-label="Sort" ref={ref} onChange={onChange}>
        <option value="a">A</option>
        <option value="b">B</option>
      </Select>,
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'b' } });
    expect(onChange).toHaveBeenCalled();
    expect(ref.current).toBe(screen.getByRole('combobox'));
  });

  it('uses the pill shape on request and keeps disabled', () => {
    render(
      <Select aria-label="Trust" pill disabled>
        <option>x</option>
      </Select>,
    );
    const s = screen.getByRole('combobox');
    expect(s.className).toContain('rounded-full');
    expect(s).toBeDisabled();
  });
});
