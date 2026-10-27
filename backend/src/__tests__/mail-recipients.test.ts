/**
 * mail-recipients.test.ts – Recipients in the reserved `.invalid` domain are
 * never handed to the SMTP relay. Unit tests for lib/mailRecipients plus the
 * wiring in mail.service (nodemailer mocked, no SMTP, no DB).
 * Dependencies: nodemailer (mocked), lib/mailRecipients, services/mail.service
 */
const sendMailMock = jest.fn<Promise<unknown>, [Record<string, unknown>]>();

jest.mock('nodemailer', () => ({
  __esModule: true,
  default: { createTransport: jest.fn(() => ({ sendMail: sendMailMock })) },
}));

import {
  deliverableRecipients,
  isUndeliverableAddress,
  skipUndeliverableRecipients,
} from '../lib/mailRecipients';
import { sendOtpEmail } from '../services/mail.service';

describe('isUndeliverableAddress', () => {
  it.each([
    ['site@allowlist-import.invalid', true],
    ['Site <site@allowlist-import.INVALID>', true],
    ['site@host.invalid.', true],
    ['site@invalid.example.de', false],
    ['admin@klinik.example.de', false],
    ['no-at-sign', false],
  ])('%s -> %s', (address, expected) => {
    expect(isUndeliverableAddress(address)).toBe(expected);
  });
});

describe('deliverableRecipients', () => {
  it('keeps a deliverable string unchanged', () => {
    expect(deliverableRecipients('a@klinik.example.de')).toBe('a@klinik.example.de');
  });

  it('drops placeholder addresses from a comma list and arrays', () => {
    expect(deliverableRecipients('a@klinik.example.de, b@x.invalid')).toBe('a@klinik.example.de');
    expect(deliverableRecipients(['b@x.invalid', 'c@klinik.example.de'])).toEqual([
      'c@klinik.example.de',
    ]);
  });

  it('returns null when nothing deliverable remains', () => {
    expect(deliverableRecipients('b@x.invalid')).toBeNull();
    expect(deliverableRecipients([])).toBeNull();
    expect(deliverableRecipients(undefined)).toBeNull();
  });
});

describe('skipUndeliverableRecipients', () => {
  it('does not send a message that only has placeholder recipients', async () => {
    const send = jest.fn().mockResolvedValue({ messageId: 'x' });
    const transport = skipUndeliverableRecipients({ sendMail: send });
    await expect(transport.sendMail({ to: 'a@x.invalid', subject: 's' })).resolves.toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it('sends to the deliverable recipients only and keeps the other fields', async () => {
    const send = jest.fn().mockResolvedValue({ messageId: 'x' });
    const transport = skipUndeliverableRecipients({ sendMail: send });
    await transport.sendMail({ to: 'a@x.invalid,b@klinik.example.de', subject: 's' });
    expect(send).toHaveBeenCalledWith({ to: 'b@klinik.example.de', subject: 's' });
  });
});

describe('mail.service uses the guard', () => {
  beforeEach(() => {
    sendMailMock.mockReset();
    sendMailMock.mockResolvedValue({ messageId: 'test' });
  });

  it('skips a login code for a placeholder address', async () => {
    await sendOtpEmail('klinik@allowlist-import.invalid', '123456');
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('still sends to a normal address', async () => {
    await sendOtpEmail('admin@klinik.example.de', '123456');
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });
});
