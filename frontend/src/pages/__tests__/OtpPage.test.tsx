/**
 * OtpPage.test.tsx — the 6-digit code step. Email comes from router location
 * state (passed via the initial entry); authApi is mocked while its real error
 * helpers run. Covers the six inputs, the resend countdown (a code was just
 * sent), a successful resend restarting it, resend failures reported as they
 * are (429 with the retry time driving the countdown, other failures) instead
 * of "sent again", and the verify errors (wrong code, rate limit), all
 * announced with role="alert". Fake timers advance the countdown.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';

const { requestOtp, verifyOtp } = vi.hoisted(() => ({
  requestOtp: vi.fn(),
  verifyOtp: vi.fn(),
}));

vi.mock('../../api/auth.api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/auth.api')>();
  return { ...actual, authApi: { requestOtp, verifyOtp } };
});

const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

import { OtpPage, RESEND_COOLDOWN_S } from '../OtpPage';

const ROUTE = { pathname: '/otp', state: { email: 'admin@example.com' } };

function renderPage() {
  return renderWithProviders(<OtpPage />, { route: ROUTE });
}

async function tick(seconds: number) {
  for (let i = 0; i < seconds; i++) {
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
  }
}

function resendButton() {
  return screen.getByRole('button', { name: /Resend code/ });
}

function tooMany(retryAfter?: string) {
  return {
    response: {
      status: 429,
      headers: retryAfter ? { 'retry-after': retryAfter } : {},
      data: { error: { code: 'RATE_LIMITED', message: 'Too many requests.' } },
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  requestOtp.mockReset();
  verifyOtp.mockReset();
  navigate.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('OtpPage', () => {
  it('renders the code-entry heading and six digit inputs', () => {
    renderPage();
    expect(screen.getByText('Enter your code')).toBeInTheDocument();
    expect(screen.getAllByRole('textbox')).toHaveLength(6);
  });

  it('counts down before a code can be requested again', async () => {
    renderPage();
    expect(resendButton()).toBeDisabled();
    expect(resendButton()).toHaveTextContent('Resend code in 0:30');

    await tick(RESEND_COOLDOWN_S);
    expect(resendButton()).toBeEnabled();
    expect(resendButton()).toHaveTextContent(/^Resend code$/);
  });

  it('confirms a sent code and restarts the countdown', async () => {
    requestOtp.mockResolvedValue({});
    renderPage();
    await tick(RESEND_COOLDOWN_S);

    fireEvent.click(resendButton());
    expect(await screen.findByRole('status')).toHaveTextContent('A new code has been sent.');
    expect(requestOtp).toHaveBeenCalledWith('admin@example.com');
    expect(resendButton()).toBeDisabled();
    expect(resendButton()).toHaveTextContent('Resend code in 0:30');
  });

  it('reports a rate-limited resend with its retry time instead of "sent again"', async () => {
    requestOtp.mockRejectedValue(tooMany('120'));
    renderPage();
    await tick(RESEND_COOLDOWN_S);

    fireEvent.click(resendButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many requests. You can request a new code in 2 min.',
    );
    expect(screen.queryByText('A new code has been sent.')).not.toBeInTheDocument();
    // The retry time drives the countdown.
    expect(resendButton()).toHaveTextContent('Resend code in 2:00');
  });

  it('reports a rate limit without a retry time', async () => {
    requestOtp.mockRejectedValue(tooMany());
    renderPage();
    await tick(RESEND_COOLDOWN_S);
    fireEvent.click(resendButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many requests. Please wait a few minutes before requesting a new code.',
    );
  });

  it('reports any other resend failure and allows a retry', async () => {
    requestOtp.mockRejectedValue(new Error('Network Error'));
    renderPage();
    await tick(RESEND_COOLDOWN_S);
    fireEvent.click(resendButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The code could not be sent. Please try again.',
    );
    expect(resendButton()).toBeEnabled();
  });

  it('announces a wrong code and clears the inputs', async () => {
    verifyOtp.mockRejectedValue({ response: { status: 401, data: {} } });
    renderPage();
    fireEvent.paste(screen.getByRole('group', { name: 'One-time code' }), {
      clipboardData: { getData: () => '123456' },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Invalid or expired code. Please try again.',
    );
    expect(verifyOtp).toHaveBeenCalledWith('admin@example.com', '123456');
    screen.getAllByRole('textbox').forEach((input) => expect(input).toHaveValue(''));
    // The emptied boxes stay marked invalid until the next digit.
    screen
      .getAllByRole('textbox')
      .forEach((input) => expect(input).toHaveAttribute('aria-invalid', 'true'));
    fireEvent.change(screen.getByLabelText('Digit 1 of 6'), { target: { value: '4' } });
    expect(screen.getByLabelText('Digit 2 of 6')).not.toHaveAttribute('aria-invalid');
  });

  it('announces a rate-limited verification with its retry time', async () => {
    verifyOtp.mockRejectedValue(tooMany('899'));
    renderPage();
    fireEvent.paste(screen.getByRole('group', { name: 'One-time code' }), {
      clipboardData: { getData: () => '123456' },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many attempts. Please try again in 15 min.',
    );
  });

  it('pops the digit boxes in one after another', () => {
    renderPage();
    screen.getAllByRole('textbox').forEach((input, i) => {
      expect(input).toHaveClass('animate-auth-digit-in');
      expect(input.style.getPropertyValue('--stagger-index')).toBe(String(i));
    });
  });
});
