/**
 * Button.test.tsx — the shared button never submits a form unless asked to,
 * maps variant and size onto the .btn classes, forwards its ref (dialogs use it
 * for initial focus) and stays a real disabled button rather than a styled
 * span.
 */
import { describe, it, expect, vi } from 'vitest';
import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '../Button';

describe('Button', () => {
  it('defaults to a primary medium button of type "button"', () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveClass('btn', 'press-effect', 'btn-md', 'btn-primary');
  });

  it('applies the requested variant, size, type and extra classes', () => {
    render(
      <Button variant="destructive" size="sm" type="submit" className="w-full">
        Delete
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Delete' });
    expect(button).toHaveAttribute('type', 'submit');
    expect(button).toHaveClass('btn-destructive', 'btn-sm', 'w-full');
    expect(button).not.toHaveClass('btn-primary', 'btn-md');
  });

  it('forwards its ref to the button element', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>Cancel</Button>);
    expect(ref.current).toBe(screen.getByRole('button', { name: 'Cancel' }));
  });

  it('does not fire clicks while disabled', async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Submit
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Submit' });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
