/**
 * Drawer.test.tsx – the narrow-layout side sheet: a modal dialog portalled to
 * <body> that slides in from its edge, focuses its close button, closes on
 * Escape and on a scrim click (not on clicks inside), keeps its content while
 * the exit animation runs (hidden from assistive tech), then unmounts and
 * returns focus to the opener.
 */
import { useRef, useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Drawer } from '../Drawer';

function Harness({
  side = 'left' as const,
  onClose,
}: {
  side?: 'left' | 'right';
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const close = () => {
    onClose?.();
    setOpen(false);
  };
  return (
    <>
      <button onClick={() => setOpen(true)}>open drawer</button>
      <Drawer
        open={open}
        onClose={close}
        side={side}
        label="Navigation"
        id="test-drawer"
        initialFocusRef={closeRef}
        className="w-[280px]"
      >
        <button ref={closeRef} onClick={close}>
          close drawer
        </button>
        <p>drawer body</p>
      </Drawer>
    </>
  );
}

describe('Drawer', () => {
  it('renders nothing while closed', () => {
    render(<Harness />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens as a labelled modal dialog in <body> and focuses the initial focus target', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'open drawer' }));

    const dialog = screen.getByRole('dialog', { name: 'Navigation' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('id', 'test-drawer');
    expect(dialog).toHaveAttribute('data-state', 'open');
    expect(dialog.className).toContain('animate-sheet-in-left');
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    expect(screen.getByRole('button', { name: 'close drawer' })).toHaveFocus();
  });

  it('slides in from the right edge when side is right', async () => {
    const user = userEvent.setup();
    render(<Harness side="right" />);
    await user.click(screen.getByRole('button', { name: 'open drawer' }));
    expect(screen.getByRole('dialog').className).toContain('animate-sheet-in-right');
  });

  it('closes on Escape, keeps its content during the exit, then unmounts and restores focus', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const opener = screen.getByRole('button', { name: 'open drawer' });
    await user.click(opener);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);

    // Exit animation: still mounted, marked closed and hidden from assistive tech.
    const panel = document.getElementById('test-drawer');
    expect(panel).toHaveAttribute('data-state', 'closed');
    expect(screen.getByText('drawer body')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await waitFor(() => expect(document.getElementById('test-drawer')).toBeNull());
    expect(opener).toHaveFocus();
  });

  it('closes on a scrim click but not on a click inside the panel', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'open drawer' }));

    fireEvent.click(screen.getByText('drawer body'));
    expect(onClose).not.toHaveBeenCalled();

    const scrim = screen.getByRole('dialog').previousElementSibling as HTMLElement;
    fireEvent.click(scrim);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps keyboard focus inside the open drawer', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'open drawer' }));

    await user.tab();
    expect(screen.getByRole('button', { name: 'close drawer' })).toHaveFocus();
  });
});
