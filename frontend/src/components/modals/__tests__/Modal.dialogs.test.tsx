/**
 * Modal.dialogs.test.tsx — the dialog-primitive behaviour behind every modal:
 * - stacking: Escape and scrim clicks reach only the top-most dialog, also when
 *   the CrossUserConfirmDialog opens over a form modal;
 * - focus: it moves into the dialog on open, Tab wraps inside it, and it returns
 *   to the opener on close;
 * - the panel is labelled by its title and leaves the accessibility tree as
 *   soon as it starts closing, unmounting after the exit animation;
 * - isDirty: every close request first asks to discard the changes.
 */
import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { Modal } from '../Modal';
import { CrossUserConfirmDialog } from '../../layout/CrossUserConfirmDialog';

function scrims() {
  return Array.from(document.querySelectorAll<HTMLElement>('.scrim'));
}

function NestedModals({ onOuterClose }: { onOuterClose: () => void }) {
  const [inner, setInner] = useState(false);
  return (
    <Modal open onClose={onOuterClose} title="Edit endpoint">
      <button type="button" onClick={() => setInner(true)}>
        Show details
      </button>
      <Modal open={inner} onClose={() => setInner(false)} title="Details">
        <p>Endpoint details</p>
      </Modal>
    </Modal>
  );
}

function OpenerHarness({ isDirty = false }: { isDirty?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Edit organization
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Organization" isDirty={isDirty}>
        <input aria-label="Name" />
        <button type="button">Save</button>
      </Modal>
    </>
  );
}

describe('Modal dialog stack', () => {
  it('closes only the top-most dialog on Escape', async () => {
    const onOuterClose = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<NestedModals onOuterClose={onOuterClose} />);

    await user.click(screen.getByRole('button', { name: 'Show details' }));
    expect(await screen.findByRole('dialog', { name: 'Details' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Details' })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('dialog', { name: 'Edit endpoint' })).toBeInTheDocument();
    expect(onOuterClose).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');
    expect(onOuterClose).toHaveBeenCalledTimes(1);
  });

  it('ignores scrim clicks on a dialog that is covered by another one', async () => {
    const onOuterClose = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<NestedModals onOuterClose={onOuterClose} />);
    await user.click(screen.getByRole('button', { name: 'Show details' }));
    await screen.findByRole('dialog', { name: 'Details' });

    const [outerScrim, innerScrim] = scrims();
    fireEvent.click(outerScrim);
    expect(onOuterClose).not.toHaveBeenCalled();

    fireEvent.click(innerScrim);
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Details' })).not.toBeInTheDocument(),
    );
    expect(onOuterClose).not.toHaveBeenCalled();
  });

  it('lets Escape in the cross-user confirmation cancel only that dialog', async () => {
    const onClose = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    function Harness() {
      const [guardOpen, setGuardOpen] = useState(false);
      return (
        <Modal open onClose={onClose} title="Contact">
          <button type="button" onClick={() => setGuardOpen(true)}>
            Save contact
          </button>
          <CrossUserConfirmDialog
            open={guardOpen}
            ownerEmail="owner@imi-test.example.de"
            onConfirm={() => setGuardOpen(false)}
            onCancel={() => {
              onCancel();
              setGuardOpen(false);
            }}
          />
        </Modal>
      );
    }
    renderWithProviders(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Save contact' }));
    await screen.findByRole('heading', { name: /Modify another user's data\?/i });

    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Contact' })).toBeInTheDocument();
  });
});

describe('Modal focus and labelling', () => {
  it('moves focus into the dialog and returns it to the opener on close', async () => {
    const user = userEvent.setup();
    renderWithProviders(<OpenerHarness />);
    const opener = screen.getByRole('button', { name: 'Edit organization' });

    await user.click(opener);
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus());

    await user.keyboard('{Escape}');
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('keeps Tab inside the dialog', async () => {
    const user = userEvent.setup();
    renderWithProviders(<OpenerHarness />);
    await user.click(screen.getByRole('button', { name: 'Edit organization' }));
    const save = await screen.findByRole('button', { name: 'Save' });

    save.focus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();

    await user.tab({ shift: true });
    expect(save).toHaveFocus();
  });

  it('is labelled by its title and leaves the accessibility tree while closing', async () => {
    const onClose = vi.fn();
    const { rerender } = renderWithProviders(
      <Modal open onClose={onClose} title="Organization" subtitle="Edit the master data">
        <p>content</p>
      </Modal>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Organization' });
    expect(dialog).not.toHaveAttribute('aria-label');
    expect(dialog).toHaveAttribute(
      'aria-labelledby',
      screen.getByRole('heading', { name: 'Organization' }).id,
    );
    expect(dialog).toHaveAccessibleDescription('Edit the master data');

    rerender(
      <Modal open={false} onClose={onClose} title="Organization">
        <p>content</p>
      </Modal>,
    );
    // Still mounted for the exit animation, but no longer exposed as a dialog.
    expect(dialog).toHaveAttribute('data-state', 'closed');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
  });
});

describe('Modal with unsaved changes', () => {
  it('asks before closing on Escape and stays open when the user keeps editing', async () => {
    const user = userEvent.setup();
    renderWithProviders(<OpenerHarness isDirty />);
    await user.click(screen.getByRole('button', { name: 'Edit organization' }));
    await screen.findByRole('dialog', { name: 'Organization' });

    await user.keyboard('{Escape}');
    const confirm = await screen.findByRole('alertdialog', { name: 'Discard changes?' });
    expect(screen.getByRole('button', { name: 'Keep editing' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(confirm).not.toBeInTheDocument());
    expect(screen.getByRole('dialog', { name: 'Organization' })).toBeInTheDocument();
  });

  it('closes after the user confirms the discard from the close button', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <Modal open onClose={onClose} title="Organization" isDirty>
        <input aria-label="Name" />
      </Modal>,
    );

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).not.toHaveBeenCalled();
    await user.click(await screen.findByRole('button', { name: 'Discard' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('asks on a scrim click, and Escape in the question cancels only the question', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <Modal open onClose={onClose} title="Organization" isDirty>
        <input aria-label="Name" />
      </Modal>,
    );

    fireEvent.click(scrims()[0]);
    const confirm = await screen.findByRole('alertdialog', { name: 'Discard changes?' });

    await user.keyboard('{Escape}');
    await waitFor(() => expect(confirm).not.toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Organization' })).toBeInTheDocument();
  });

  it('closes without asking when nothing changed', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <Modal open onClose={onClose} title="Organization">
        <input aria-label="Name" />
      </Modal>,
    );

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
