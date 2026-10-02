/**
 * FormField.test.tsx — the shared form primitives: label ↔ control
 * association (single element and render function), hint and error wired
 * through aria-describedby, aria-invalid, announced errors, the screen-reader
 * text of the required asterisk, the checkbox group and the ModalFooter
 * (Back / Cancel / primary CTA, busy state).
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { FormField, FormFieldGroup, ModalFooter } from '../FormField';

describe('FormField', () => {
  it('renders its label and children', () => {
    renderWithProviders(
      <FormField label="Email Address">
        <input data-testid="the-input" />
      </FormField>,
    );
    expect(screen.getByText('Email Address')).toBeInTheDocument();
    expect(screen.getByTestId('the-input')).toBeInTheDocument();
  });

  it('shows the error text when the error prop is set', () => {
    renderWithProviders(
      <FormField label="Email Address" error="This field is required">
        <input />
      </FormField>,
    );
    expect(screen.getByText('This field is required')).toBeInTheDocument();
  });

  it('does not show error text when no error is provided', () => {
    renderWithProviders(
      <FormField label="Email Address" hint="Some hint">
        <input />
      </FormField>,
    );
    expect(screen.queryByText('This field is required')).not.toBeInTheDocument();
    expect(screen.getByText('Some hint')).toBeInTheDocument();
  });

  it('associates the label with its input via matching htmlFor/id', () => {
    renderWithProviders(
      <FormField label="Email Address">
        <input data-testid="the-input" />
      </FormField>,
    );
    const label = screen.getByText('Email Address');
    const input = screen.getByTestId('the-input');
    expect(label.getAttribute('for')).toBeTruthy();
    expect(label.getAttribute('for')).toBe(input.getAttribute('id'));
  });

  it('keeps an explicitly provided child id and points the label at it', () => {
    renderWithProviders(
      <FormField label="Email Address">
        <input id="explicit-id" data-testid="the-input" />
      </FormField>,
    );
    expect(screen.getByTestId('the-input').getAttribute('id')).toBe('explicit-id');
    expect(screen.getByText('Email Address').getAttribute('for')).toBe('explicit-id');
  });

  it('resolves an error that is a known translation key', () => {
    // When a Zod schema emits a stable i18n key code as its message, FormField
    // resolves it to the localized string instead of rendering the raw code.
    renderWithProviders(
      <FormField label="Some Field" error="modalSaveBtn">
        <input />
      </FormField>,
    );
    expect(screen.getByText('Save')).toBeInTheDocument();
    expect(screen.queryByText('modalSaveBtn')).not.toBeInTheDocument();
  });

  it('describes the control with its hint', () => {
    renderWithProviders(
      <FormField label="Country" hint="ISO 3166-1 alpha-2">
        <input />
      </FormField>,
    );
    expect(screen.getByRole('textbox', { name: 'Country' })).toHaveAccessibleDescription(
      'ISO 3166-1 alpha-2',
    );
    expect(screen.getByRole('textbox')).not.toHaveAttribute('aria-invalid');
  });

  it('announces the error, marks the control invalid and describes it with the error', () => {
    renderWithProviders(
      <FormField label="Country" hint="ISO 3166-1 alpha-2" error="countryCodeInvalid">
        <input aria-describedby="extra" />
      </FormField>,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Must be a 2-letter ISO country code (e.g. DE)');
    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    // The hint gives way to the error; an existing description is kept.
    expect(input.getAttribute('aria-describedby')).toBe(`extra ${alert.id}`);
    expect(screen.queryByText('ISO 3166-1 alpha-2')).not.toBeInTheDocument();
  });

  it('gives the required asterisk screen-reader text', () => {
    renderWithProviders(
      <FormField label="Name" required>
        <input />
      </FormField>,
    );
    expect(screen.getByRole('textbox', { name: 'Name (required)' })).toBeInTheDocument();
    expect(screen.getByText('*')).toHaveAttribute('aria-hidden', 'true');
  });

  it('hands id and aria props to a composite control through a render function', () => {
    renderWithProviders(
      <FormField label="Certificate" hint="PEM only" error="Too short">
        {(control) => (
          <div>
            <button type="button">Choose file</button>
            <textarea {...control} />
          </div>
        )}
      </FormField>,
    );
    const textarea = screen.getByRole('textbox', { name: 'Certificate' });
    expect(textarea).toHaveAttribute('aria-invalid', 'true');
    expect(textarea).toHaveAccessibleDescription(/Too short/);
  });
});

describe('FormFieldGroup', () => {
  it('labels the group and describes it with the error', () => {
    renderWithProviders(
      <FormFieldGroup label="Roles" required error="membershipRolesRequired">
        <input type="checkbox" aria-label="DIC" />
      </FormFieldGroup>,
    );
    const group = screen.getByRole('group', { name: 'Roles (required)' });
    expect(group).toHaveAccessibleDescription(/Select at least one role/);
    expect(screen.getByRole('alert')).toHaveTextContent('Select at least one role');
  });
});

describe('ModalFooter', () => {
  it('renders Cancel and one primary submit button', () => {
    const onCancel = vi.fn();
    renderWithProviders(
      <form>
        <ModalFooter onCancel={onCancel} submitLabel="Add Contact" />
      </form>,
    );
    const submit = screen.getByRole('button', { name: 'Add Contact' });
    expect(submit).toHaveAttribute('type', 'submit');
    expect(submit).toHaveClass('btn-primary');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('shows the busy label and disables the primary button while loading', () => {
    renderWithProviders(
      <ModalFooter onCancel={() => {}} onSubmit={() => {}} loading loadingLabel="Creating…" />,
    );
    expect(screen.getByRole('button', { name: 'Creating…' })).toBeDisabled();
  });

  it('offers Back when a step can be undone and can hide the submit button', () => {
    const onBack = vi.fn();
    renderWithProviders(<ModalFooter onCancel={() => {}} onBack={onBack} hideSubmit />);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });
});
