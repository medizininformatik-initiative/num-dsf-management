/**
 * ApprovalDeciders.test.tsx – shows which admins approved/rejected a request.
 */
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { ApprovalDeciders } from '../ApprovalDeciders';
import type { ApprovalRequest } from '../../../hooks/useApproval';

const base: ApprovalRequest = {
  id: 'r1',
  status: 'APPROVED',
  created_at: '2026-01-01T00:00:00Z',
  submitted_at: null,
  resolved_at: null,
  resolved_by: 'c@imi.de',
  comment: null,
};

describe('ApprovalDeciders', () => {
  it('lists all approving admins', () => {
    renderWithProviders(
      <ApprovalDeciders
        req={{
          ...base,
          decisions: [
            { admin_email: 'a@imi.de', decision: 'APPROVE', signed_at: '2026-01-01T00:00:00Z' },
            { admin_email: 'c@imi.de', decision: 'APPROVE', signed_at: '2026-01-02T00:00:00Z' },
          ],
        }}
      />,
    );
    expect(screen.getByTestId('approval-deciders')).toHaveTextContent(
      /Approved by a@imi\.de, c@imi\.de/,
    );
  });

  it('shows the rejecting admin', () => {
    renderWithProviders(
      <ApprovalDeciders
        req={{
          ...base,
          status: 'REJECTED',
          decisions: [
            { admin_email: 'a@imi.de', decision: 'REJECT', signed_at: '2026-01-01T00:00:00Z' },
          ],
        }}
      />,
    );
    expect(screen.getByTestId('approval-deciders')).toHaveTextContent(/Rejected by a@imi\.de/);
  });

  it('falls back to resolved_by and hides system actors and unresolved requests', () => {
    const { rerender } = renderWithProviders(<ApprovalDeciders req={base} />);
    expect(screen.getByTestId('approval-deciders')).toHaveTextContent(/c@imi\.de/);
    rerender(<ApprovalDeciders req={{ ...base, resolved_by: 'SYSTEM:silent-consent' }} />);
    expect(screen.queryByTestId('approval-deciders')).toBeNull();
    rerender(<ApprovalDeciders req={{ ...base, status: 'PENDING' }} />);
    expect(screen.queryByTestId('approval-deciders')).toBeNull();
  });
});
