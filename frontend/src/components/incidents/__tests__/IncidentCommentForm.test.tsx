/**
 * IncidentCommentForm.test.tsx — an empty comment cannot be sent; a comment
 * is sent trimmed and the field empties afterwards. incidents.api is mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/renderWithProviders';

const { commentMock } = vi.hoisted(() => ({ commentMock: vi.fn() }));
vi.mock('../../../api/incidents.api', () => ({ incidentsApi: { comment: commentMock } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { IncidentCommentForm } from '../IncidentCommentForm';

beforeEach(() => {
  vi.clearAllMocks();
  commentMock.mockResolvedValue({ data: { data: { id: 'e9' } } });
});

describe('IncidentCommentForm', () => {
  it('adds a trimmed comment to the timeline', async () => {
    const user = userEvent.setup();
    renderWithProviders(<IncidentCommentForm incidentId="i1" />);
    const submit = screen.getByRole('button', { name: 'Add to timeline' });
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText('Comment'), '  Site called back, server isolated ');
    await user.click(submit);
    await waitFor(() =>
      expect(commentMock).toHaveBeenCalledWith('i1', 'Site called back, server isolated'),
    );
    await waitFor(() => expect(screen.getByLabelText('Comment')).toHaveValue(''));
  });
});
