/**
 * notification.service.ts – Email notifications for approval workflow
 * Dependencies: nodemailer, .env (SMTP_*, MAIL_FROM, DSF_ENVIRONMENT)
 *
 * Functions:
 *   sendAdminNewRequestEmail    – notify admins of a new approval request
 *   sendAdminApprovalResultEmail – notify admins of approve/reject outcome
 *   sendSiteApprovalResultEmail  – notify site contacts of approve/reject outcome
 *   sendIncidentEmail            – incident register notices (admins, sites)
 */
import nodemailer from 'nodemailer';
import { escapeHtml as esc } from '../lib/escapeHtml';
import { skipUndeliverableRecipients } from '../lib/mailRecipients';

function titleCase(s: string): string {
  return s.charAt(0) + s.slice(1).toLowerCase();
}

const IS_TEST = process.env.NODE_ENV === 'test';

const transporter = skipUndeliverableRecipients(
  nodemailer.createTransport({
    host: IS_TEST ? 'localhost' : process.env.SMTP_HOST || 'mail',
    port: parseInt(process.env.SMTP_PORT || '1025'),
    secure: false,
    // Reuse SMTP connections across the per-recipient sendMail calls instead of
    // opening a fresh connection each time; cap concurrency so a large contact
    // list can't exhaust the relay's connection slots.
    pool: true,
    maxConnections: 5,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  }),
);

const FROM = process.env.MAIL_FROM || 'noreply@dsf-allowlist.local';
const ENV = process.env.DSF_ENVIRONMENT || 'TEST';

const BRAND = '#6c63ff';
const COLOR_APPROVED = '#22c55e';
const COLOR_REJECTED = '#ef4444';

function statusBadge(status: 'APPROVED' | 'REJECTED'): string {
  const color = status === 'APPROVED' ? COLOR_APPROVED : COLOR_REJECTED;
  return `<span style="display:inline-block;padding:3px 10px;border-radius:4px;background:${color};color:#fff;font-weight:bold;font-size:13px;">${status}</span>`;
}

function baseHtml(title: string, body: string): string {
  return `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#1a1a2e;">
      <h2 style="color:${BRAND};margin-bottom:4px;">DSF Allow List – ${ENV}</h2>
      <h3 style="margin-top:0;color:#333;">${title}</h3>
      ${body}
      <p style="color:#9b9fad;font-size:12px;margin-top:32px;border-top:1px solid #eee;padding-top:12px;">
        This is an automated message from the DSF Management Portal.
      </p>
    </div>
  `;
}

export async function sendAdminNewRequestEmail(
  adminEmails: string[],
  orgName: string,
  orgIdentifier: string,
  submittedBy: string,
  requestId: string,
): Promise<void> {
  if (adminEmails.length === 0 || IS_TEST) return;

  const subject = `[DSF Allow List – ${ENV}] New approval request from ${orgName}`;

  const text = [
    `DSF Allow List – ${ENV}`,
    ``,
    `New approval request submitted.`,
    ``,
    `Organization : ${orgName} (${orgIdentifier})`,
    `Submitted by : ${submittedBy}`,
    `Request ID   : ${requestId}`,
    ``,
    `Please log in to the portal to review this request.`,
  ].join('\n');

  const html = baseHtml(
    'New Approval Request',
    `
    <p>A new approval request has been submitted and requires your review.</p>
    <table style="border-collapse:collapse;width:100%;font-size:14px;">
      <tr><td style="padding:6px 12px 6px 0;color:#666;white-space:nowrap;">Organization</td>
          <td style="padding:6px 0;font-weight:bold;">${esc(orgName)}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#666;">Identifier</td>
          <td style="padding:6px 0;">${esc(orgIdentifier)}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#666;">Submitted by</td>
          <td style="padding:6px 0;">${esc(submittedBy)}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#666;">Request ID</td>
          <td style="padding:6px 0;font-family:monospace;font-size:12px;">${esc(requestId)}</td></tr>
    </table>
    <p style="margin-top:20px;">
      <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/app/admin"
         style="display:inline-block;padding:10px 20px;background:${BRAND};color:#fff;border-radius:6px;text-decoration:none;font-weight:bold;">
        Review in Portal
      </a>
    </p>
  `,
  );

  await transporter.sendMail({ from: FROM, to: adminEmails.join(','), subject, text, html });
}

export async function sendAdminApprovalResultEmail(
  adminEmails: string[],
  orgName: string,
  orgIdentifier: string,
  status: 'APPROVED' | 'REJECTED',
  resolvedBy: string,
  comment: string | null,
): Promise<void> {
  if (adminEmails.length === 0 || IS_TEST) return;

  const subject = `[DSF Allow List – ${ENV}] Request ${status.toLowerCase()} – ${orgName}`;

  const commentLine = comment ? `\nComment      : ${comment}` : '';
  const text = [
    `DSF Allow List – ${ENV}`,
    ``,
    `An approval request has been ${status.toLowerCase()}.`,
    ``,
    `Organization : ${orgName} (${orgIdentifier})`,
    `Status       : ${status}`,
    `Resolved by  : ${resolvedBy}`,
    commentLine,
  ]
    .filter((line) => line !== '')
    .join('\n');

  const commentHtml = comment
    ? `<tr><td style="padding:6px 12px 6px 0;color:#666;white-space:nowrap;">Comment</td>
           <td style="padding:6px 0;">${esc(comment)}</td></tr>`
    : '';

  const html = baseHtml(
    `Request ${titleCase(status)}`,
    `
    <p>An approval request has been resolved.</p>
    <table style="border-collapse:collapse;width:100%;font-size:14px;">
      <tr><td style="padding:6px 12px 6px 0;color:#666;white-space:nowrap;">Organization</td>
          <td style="padding:6px 0;font-weight:bold;">${esc(orgName)}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#666;">Identifier</td>
          <td style="padding:6px 0;">${esc(orgIdentifier)}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#666;">Status</td>
          <td style="padding:6px 0;">${statusBadge(status)}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#666;">Resolved by</td>
          <td style="padding:6px 0;">${esc(resolvedBy)}</td></tr>
      ${commentHtml}
    </table>
  `,
  );

  await transporter.sendMail({ from: FROM, to: adminEmails.join(','), subject, text, html });
}

export async function sendAdminFirstApprovalEmail(
  adminEmails: string[],
  orgName: string,
  orgId: string,
  firstApproverEmail: string,
  requestId: string,
): Promise<void> {
  if (adminEmails.length === 0 || IS_TEST) return;

  const days = parseInt(process.env.APPROVAL_SILENT_CONSENT_DAYS || '7', 10);
  const subject = `[DSF Allow List – ${ENV}] First approval recorded for ${orgName}`;

  const text = [
    `DSF Allow List – ${ENV}`,
    ``,
    `${firstApproverEmail} has approved the request for ${orgName} (${orgId}).`,
    ``,
    `A second admin from a different site must approve OR reject within ${days} days.`,
    `If no rejection arrives in that window, the request will be auto-approved (Schweigen als Zustimmung).`,
    ``,
    `Request ID: ${requestId}`,
  ].join('\n');

  const html = baseHtml(
    'First Approval Recorded',
    `
    <p><strong>${esc(firstApproverEmail)}</strong> has approved the request for <strong>${esc(orgName)}</strong> (${esc(orgId)}).</p>
    <p>A second admin from a <strong>different site</strong> must approve OR reject within <strong>${days} days</strong>.</p>
    <p>If no rejection arrives in that window, the request will be automatically approved (<em>Schweigen als Zustimmung</em>).</p>
    <table style="border-collapse:collapse;width:100%;font-size:14px;">
      <tr><td style="padding:6px 12px 6px 0;color:#666;white-space:nowrap;">Organization</td>
          <td style="padding:6px 0;font-weight:bold;">${esc(orgName)}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#666;">Identifier</td>
          <td style="padding:6px 0;">${esc(orgId)}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#666;">First approved by</td>
          <td style="padding:6px 0;">${esc(firstApproverEmail)}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#666;">Request ID</td>
          <td style="padding:6px 0;font-family:monospace;font-size:12px;">${esc(requestId)}</td></tr>
    </table>
    <p style="margin-top:20px;">
      <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/app/admin"
         style="display:inline-block;padding:10px 20px;background:${BRAND};color:#fff;border-radius:6px;text-decoration:none;font-weight:bold;">
        Review in Portal
      </a>
    </p>
  `,
  );

  await transporter.sendMail({ from: FROM, to: adminEmails.join(','), subject, text, html });
}

export async function sendSiteApprovalResultEmail(
  contactEmails: string[],
  orgName: string,
  status: 'APPROVED' | 'REJECTED',
  comment: string | null,
): Promise<void> {
  if (contactEmails.length === 0 || IS_TEST) return;

  const subject = `[DSF Allow List – ${ENV}] Your request has been ${status.toLowerCase()} – ${orgName}`;

  const commentLine = comment ? `\n\nComment from the reviewer:\n${comment}` : '';
  const text = [
    `DSF Allow List – ${ENV}`,
    ``,
    `Your approval request for ${orgName} has been ${status.toLowerCase()}.`,
    commentLine,
    ``,
    `If you have questions, please contact the GECKO team.`,
  ]
    .filter((s) => s !== '')
    .join('\n');

  const commentHtml = comment
    ? `<div style="margin-top:16px;padding:12px;background:#f8f8fb;border-left:4px solid #ddd;border-radius:4px;">
         <p style="margin:0 0 4px 0;color:#666;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Reviewer comment</p>
         <p style="margin:0;">${esc(comment)}</p>
       </div>`
    : '';

  const outcomeColor = status === 'APPROVED' ? COLOR_APPROVED : COLOR_REJECTED;
  const outcomeText =
    status === 'APPROVED'
      ? 'Congratulations – your DSF Allow List entry has been approved.'
      : 'Unfortunately, your DSF Allow List request was not approved at this time.';

  const html = baseHtml(
    `Request ${titleCase(status)}`,
    `
    <div style="padding:16px;border-radius:8px;border:2px solid ${outcomeColor};margin-bottom:20px;">
      <p style="margin:0;">${statusBadge(status)}&nbsp;&nbsp;${outcomeText}</p>
    </div>
    ${commentHtml}
    <p style="margin-top:20px;font-size:13px;color:#555;">
      If you have questions or wish to resubmit, please log in to the portal or contact the GECKO team.
    </p>
  `,
  );

  await transporter.sendMail({ from: FROM, to: contactEmails.join(','), subject, text, html });
}

/**
 * sendApprovedBundleNotification — the structured post-approval email for a
 * SITE contact (one recipient at a time so each gets their locale).
 *
 * The legacy sendSiteApprovalResultEmail above stays in place for REJECTED
 * paths (it carries the reviewer comment). For APPROVED we want the new
 * verification-focused template: bundle version, content hash, signature
 * kid, download + verify URLs, change counts vs the previous version.
 */
import {
  renderApprovedBundleMail,
  type ApprovedBundleMailContext,
} from './mail-templates/approved-bundle-mail';

export async function sendApprovedBundleNotification(
  recipient: { email: string; name?: string | null; language: 'en' | 'de' },
  context: Omit<ApprovedBundleMailContext, 'language' | 'recipientName'>,
): Promise<void> {
  if (IS_TEST) return;
  const { subject, text, html } = renderApprovedBundleMail({
    ...context,
    language: recipient.language,
    recipientName: recipient.name ?? null,
  });
  await transporter.sendMail({ from: FROM, to: recipient.email, subject, text, html });
}

export async function sendAdminPromotionRequestedEmail(
  recipientAdminEmails: string[],
  targetEmail: string,
  requestedBy: string,
  requestId: string,
): Promise<void> {
  if (recipientAdminEmails.length === 0 || IS_TEST) return;
  const subject = `[DSF Allow List – ${ENV}] Admin promotion request: ${targetEmail}`;
  const text = [
    `DSF Allow List – ${ENV}`,
    ``,
    `${requestedBy} has requested to promote ${targetEmail} to IMI admin.`,
    ``,
    `Two admins from different sites must approve. Open the portal to review:`,
    `${process.env.FRONTEND_URL || 'http://localhost:5173'}/app/admin/promotions`,
    ``,
    `Request ID: ${requestId}`,
  ].join('\n');
  const html = baseHtml(
    'New Admin Promotion Request',
    `
    <p><strong>${esc(requestedBy)}</strong> has requested to promote <strong>${esc(targetEmail)}</strong> to IMI admin.</p>
    <p>Two admins from <strong>different sites</strong> must explicitly approve.</p>
    <table style="border-collapse:collapse;width:100%;font-size:14px;">
      <tr><td style="padding:6px 12px 6px 0;color:#666;white-space:nowrap;">Target</td>
          <td style="padding:6px 0;font-weight:bold;">${esc(targetEmail)}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#666;">Requested by</td>
          <td style="padding:6px 0;">${esc(requestedBy)}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#666;">Request ID</td>
          <td style="padding:6px 0;font-family:monospace;font-size:12px;">${esc(requestId)}</td></tr>
    </table>
    <p style="margin-top:20px;">
      <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/app/admin/promotions"
         style="display:inline-block;padding:10px 20px;background:${BRAND};color:#fff;border-radius:6px;text-decoration:none;font-weight:bold;">
        Review in Portal
      </a>
    </p>
  `,
  );
  await transporter.sendMail({
    from: FROM,
    to: recipientAdminEmails.join(','),
    subject,
    text,
    html,
  });
}

export async function sendCertExpiryWarning(
  to: string,
  opts: {
    orgName: string;
    orgIdentifier: string;
    subject: string;
    daysLeft: number;
    validUntil: string;
  },
): Promise<void> {
  if (IS_TEST) return;

  const mailSubject = `[DSF Allow List – ${ENV}] Certificate expiring in ${opts.daysLeft} day${opts.daysLeft === 1 ? '' : 's'} for ${opts.orgName}`;

  const text = [
    `DSF Allow List – ${ENV}`,
    ``,
    `A certificate for ${opts.orgName} (${opts.orgIdentifier}) is about to expire.`,
    ``,
    `Certificate subject : ${opts.subject}`,
    `Valid until          : ${opts.validUntil}`,
    `Days remaining       : ${opts.daysLeft}`,
    ``,
    `Please renew it via the DSF Allow List portal before it expires.`,
  ].join('\n');

  const urgencyColor = opts.daysLeft <= 7 ? '#ef4444' : opts.daysLeft <= 30 ? '#f97316' : '#f59e0b';

  const html = baseHtml(
    'Certificate Expiry Warning',
    `
    <div style="padding:16px;border-radius:8px;border:2px solid ${urgencyColor};margin-bottom:20px;">
      <p style="margin:0;font-weight:bold;color:${urgencyColor};">
        Certificate expires in ${opts.daysLeft} day${opts.daysLeft === 1 ? '' : 's'}
      </p>
    </div>
    <table style="border-collapse:collapse;width:100%;font-size:14px;">
      <tr><td style="padding:6px 12px 6px 0;color:#666;white-space:nowrap;">Organization</td>
          <td style="padding:6px 0;font-weight:bold;">${esc(opts.orgName)}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#666;">Identifier</td>
          <td style="padding:6px 0;">${esc(opts.orgIdentifier)}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#666;">Certificate subject</td>
          <td style="padding:6px 0;font-family:monospace;font-size:12px;">${esc(opts.subject)}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#666;">Valid until</td>
          <td style="padding:6px 0;">${esc(opts.validUntil)}</td></tr>
    </table>
    <p style="margin-top:20px;">
      <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/app"
         style="display:inline-block;padding:10px 20px;background:${BRAND};color:#fff;border-radius:6px;text-decoration:none;font-weight:bold;">
        Renew in Portal
      </a>
    </p>
  `,
  );

  await transporter.sendMail({ from: FROM, to, subject: mailSubject, text, html });
}

export async function sendAdminPromotionResultEmail(
  recipients: string[],
  targetEmail: string,
  status: 'APPROVED' | 'REJECTED' | 'CANCELLED',
  reason: string | null,
): Promise<void> {
  if (recipients.length === 0 || IS_TEST) return;
  const subject =
    status === 'APPROVED'
      ? `[DSF Allow List – ${ENV}] Admin promotion approved: ${targetEmail}`
      : status === 'REJECTED'
        ? `[DSF Allow List – ${ENV}] Admin promotion rejected: ${targetEmail}`
        : `[DSF Allow List – ${ENV}] Admin promotion cancelled: ${targetEmail}`;
  const reasonLine = reason ? `\n\nReason: ${reason}` : '';
  const text = [
    `DSF Allow List – ${ENV}`,
    ``,
    `Promotion request for ${targetEmail} was ${status.toLowerCase()}.`,
    reasonLine,
  ]
    .filter(Boolean)
    .join('\n');
  const reasonHtml = reason
    ? `<div style="margin-top:16px;padding:12px;background:#f8f8fb;border-left:4px solid #ddd;border-radius:4px;">
         <p style="margin:0 0 4px 0;color:#666;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Reason</p>
         <p style="margin:0;">${esc(reason)}</p>
       </div>`
    : '';
  const statusColor =
    status === 'APPROVED' ? COLOR_APPROVED : status === 'REJECTED' ? COLOR_REJECTED : '#9b9fad';
  const html = baseHtml(
    `Admin Promotion ${titleCase(status)}`,
    `
    <p>Promotion request for <strong>${esc(targetEmail)}</strong> was
      <span style="font-weight:bold;color:${statusColor};">${status.toLowerCase()}</span>.
    </p>
    ${reasonHtml}
  `,
  );
  await transporter.sendMail({ from: FROM, to: recipients.join(','), subject, text, html });
}

const portalUrl = (): string => process.env.FRONTEND_URL || 'http://localhost:5173';

/** Expiry warning for an admin login certificate (German first, English below). */
export async function sendAdminCertExpiryWarning(
  to: string,
  opts: { daysLeft: number; validUntil: string; subject: string },
): Promise<void> {
  if (IS_TEST) return;
  const link = `${portalUrl()}/app/admin/certificates`;
  const tage = `${opts.daysLeft} Tag${opts.daysLeft === 1 ? '' : 'en'}`;
  const days = `${opts.daysLeft} day${opts.daysLeft === 1 ? '' : 's'}`;
  const text = [
    `DSF Management Tool – ${ENV}`,
    ``,
    `Ihr Admin-Zertifikat für das DSF Management Tool läuft am ${opts.validUntil} ab (in ${tage}).`,
    `Hinterlegen Sie rechtzeitig ein Nachfolge-Zertifikat unter ${link}.`,
    `Nach Ablauf ist keine Anmeldung mehr möglich; dann kann nur noch ein Kollege oder der Serverbetreiber ein neues Zertifikat hinterlegen.`,
    ``,
    `Your admin certificate for the DSF Management Tool expires on ${opts.validUntil} (in ${days}).`,
    `Please register a successor certificate at ${link} in time.`,
    `Certificate: ${opts.subject}`,
  ].join('\n');
  const html = baseHtml(
    'Admin-Zertifikat läuft ab / Admin certificate expiring',
    `
    <p>Ihr Admin-Zertifikat <span style="font-family:monospace;font-size:12px;">${esc(opts.subject)}</span>
       läuft am <strong>${esc(opts.validUntil)}</strong> ab (in ${tage}).
       Hinterlegen Sie rechtzeitig ein Nachfolge-Zertifikat.</p>
    <p style="color:#666;">Your admin certificate expires on ${esc(opts.validUntil)} (in ${days}).
       Please register a successor certificate in time.</p>
    <p style="margin-top:20px;"><a href="${link}"
       style="display:inline-block;padding:10px 20px;background:${BRAND};color:#fff;border-radius:6px;text-decoration:none;font-weight:bold;">
       Meine Admin-Zertifikate</a></p>
  `,
  );
  await transporter.sendMail({
    from: FROM,
    to,
    subject: `[DSF Management Tool – ${ENV}] Admin-Zertifikat läuft in ${tage} ab`,
    text,
    html,
  });
}

/**
 * Notice that a certificate was added to or removed from an admin account.
 * Without `targetEmail` it addresses the account holder ("your account");
 * with it, another admin is told about that colleague's account.
 */
export async function sendAdminCertChangedEmail(
  to: string,
  opts: {
    change: 'add' | 'remove';
    byAdmin: string;
    fingerprintPrefix: string;
    targetEmail?: string;
  },
): Promise<void> {
  if (IS_TEST) return;
  const added = opts.change === 'add';
  const fp = opts.fingerprintPrefix;
  const t = opts.targetEmail;
  const de = t
    ? added
      ? `Für das Admin-Konto ${t} wurde von ${opts.byAdmin} ein neues Zertifikat hinterlegt (Fingerabdruck ${fp}…).`
      : `Vom Admin-Konto ${t} wurde durch ${opts.byAdmin} ein Zertifikat entfernt (Fingerabdruck ${fp}…).`
    : added
      ? `Für Ihr Admin-Konto wurde von ${opts.byAdmin} ein neues Zertifikat hinterlegt (Fingerabdruck ${fp}…).`
      : `Von Ihrem Admin-Konto wurde durch ${opts.byAdmin} ein Zertifikat entfernt (Fingerabdruck ${fp}…).`;
  const en = t
    ? added
      ? `${opts.byAdmin} registered a new certificate for the admin account ${t} (fingerprint ${fp}…).`
      : `${opts.byAdmin} removed a certificate from the admin account ${t} (fingerprint ${fp}…).`
    : added
      ? `${opts.byAdmin} registered a new certificate for your admin account (fingerprint ${fp}…).`
      : `${opts.byAdmin} removed a certificate from your admin account (fingerprint ${fp}…).`;
  const warn =
    'Wenn Sie das nicht veranlasst haben, melden Sie sich sofort beim IMI-Betrieb. / If you did not ask for this, contact the IMI operators immediately.';
  const text = [`DSF Management Tool – ${ENV}`, ``, de, ``, en, ``, warn].join('\n');
  const html = baseHtml(
    added ? 'Admin-Zertifikat hinterlegt' : 'Admin-Zertifikat entfernt',
    `
    <p>${esc(de)}</p>
    <p style="color:#666;">${esc(en)}</p>
    <p style="font-weight:bold;color:${COLOR_REJECTED};">${esc(warn)}</p>
  `,
  );
  await transporter.sendMail({
    from: FROM,
    to,
    subject: `[DSF Management Tool – ${ENV}] ${added ? 'Neues Admin-Zertifikat hinterlegt' : 'Admin-Zertifikat entfernt'}`,
    text,
    html,
  });
}

export type AdminCertRequestEvent = 'requested' | 'approved' | 'rejected' | 'cancelled';

/**
 * Four-eyes recovery of a colleague's admin certificate: the target learns that
 * a certificate was requested for them, requester and target learn the outcome.
 */
export async function sendAdminCertRequestEmail(
  to: string[],
  opts: {
    event: AdminCertRequestEvent;
    targetEmail: string;
    requestedBy: string;
    decidedBy?: string | null;
    fingerprintPrefix: string;
    comment?: string | null;
  },
): Promise<void> {
  if (IS_TEST || to.length === 0) return;
  const fp = `${opts.fingerprintPrefix}…`;
  const who = opts.decidedBy ? ` (${opts.decidedBy})` : '';
  const copy: Record<AdminCertRequestEvent, { de: string; en: string; subject: string }> = {
    requested: {
      de: `${opts.requestedBy} hat für ${opts.targetEmail} ein Admin-Zertifikat beantragt (Fingerabdruck ${fp}). Das Zertifikat wird erst aktiv, wenn ein weiterer Admin eines anderen Standorts zustimmt.`,
      en: `${opts.requestedBy} requested an admin certificate for ${opts.targetEmail} (fingerprint ${fp}). It only becomes active once another admin from a different site approves.`,
      subject: 'Admin-Zertifikat beantragt',
    },
    approved: {
      de: `Der Antrag auf ein Admin-Zertifikat für ${opts.targetEmail} (Fingerabdruck ${fp}) wurde freigegeben${who}. Das Zertifikat ist jetzt aktiv.`,
      en: `The request for an admin certificate for ${opts.targetEmail} (fingerprint ${fp}) was approved${who}. The certificate is now active.`,
      subject: 'Admin-Zertifikat freigegeben',
    },
    rejected: {
      de: `Der Antrag auf ein Admin-Zertifikat für ${opts.targetEmail} (Fingerabdruck ${fp}) wurde abgelehnt${who}.${opts.comment ? ` Begründung: ${opts.comment}` : ''}`,
      en: `The request for an admin certificate for ${opts.targetEmail} (fingerprint ${fp}) was rejected${who}.${opts.comment ? ` Reason: ${opts.comment}` : ''}`,
      subject: 'Admin-Zertifikat abgelehnt',
    },
    cancelled: {
      de: `Der Antrag auf ein Admin-Zertifikat für ${opts.targetEmail} (Fingerabdruck ${fp}) wurde zurückgezogen oder ist abgelaufen.`,
      en: `The request for an admin certificate for ${opts.targetEmail} (fingerprint ${fp}) was withdrawn or expired.`,
      subject: 'Admin-Zertifikat: Antrag beendet',
    },
  };
  const c = copy[opts.event];
  const warn =
    'Wenn Sie das nicht erwartet haben, melden Sie sich sofort beim IMI-Betrieb. / If you did not expect this, contact the IMI operators immediately.';
  const text = [`DSF Management Tool – ${ENV}`, ``, c.de, ``, c.en, ``, warn].join('\n');
  const html = baseHtml(
    c.subject,
    `
    <p>${esc(c.de)}</p>
    <p style="color:#666;">${esc(c.en)}</p>
    <p style="font-weight:bold;color:${COLOR_REJECTED};">${esc(warn)}</p>
  `,
  );
  await transporter.sendMail({
    from: FROM,
    to,
    subject: `[DSF Management Tool – ${ENV}] ${c.subject}`,
    text,
    html,
  });
}

/** Notice to an organization's contacts that a login certificate was enabled or removed by an admin. */
export async function sendOrgLoginCertificateChangedEmail(
  to: string[],
  opts: {
    change: 'enable' | 'disable';
    orgName: string;
    byAdmin: string;
    fingerprintPrefix: string;
  },
): Promise<void> {
  if (IS_TEST || to.length === 0) return;
  const enabled = opts.change === 'enable';
  const fp = `${opts.fingerprintPrefix}…`;
  const de = enabled
    ? `Für Ihre Organisation ${opts.orgName} wurde ein Zertifikat für die Anmeldung freigegeben (Fingerabdruck ${fp}, durch ${opts.byAdmin}).`
    : `Für Ihre Organisation ${opts.orgName} wurde ein Zertifikat für die Anmeldung entfernt (Fingerabdruck ${fp}, durch ${opts.byAdmin}).`;
  const en = enabled
    ? `A certificate was enabled for logging in as your organization ${opts.orgName} (fingerprint ${fp}, by ${opts.byAdmin}).`
    : `A login certificate of your organization ${opts.orgName} was removed (fingerprint ${fp}, by ${opts.byAdmin}).`;
  const warn =
    'Wenn Sie das nicht erwartet haben, melden Sie sich beim IMI-Betrieb. / If you did not expect this, contact the IMI operators.';
  const subject = enabled ? 'Anmelde-Zertifikat freigegeben' : 'Anmelde-Zertifikat entfernt';
  const text = [`DSF Management Tool – ${ENV}`, ``, de, ``, en, ``, warn].join('\n');
  const html = baseHtml(
    subject,
    `
    <p>${esc(de)}</p>
    <p style="color:#666;">${esc(en)}</p>
    <p style="font-weight:bold;color:${COLOR_REJECTED};">${esc(warn)}</p>
  `,
  );
  await transporter.sendMail({
    from: FROM,
    to,
    subject: `[DSF Management Tool – ${ENV}] ${subject}`,
    text,
    html,
  });
}

/**
 * Incident register notice (mail-templates/incident-mail). One message per
 * recipient, so sites never see each other's addresses. Never carries the
 * incident description.
 */
import { renderIncidentMail, type IncidentMailContext } from './mail-templates/incident-mail';

export async function sendIncidentEmail(
  to: string[],
  context: Omit<IncidentMailContext, 'environment'>,
): Promise<number> {
  const recipients = [...new Set(to.map((e) => e.toLowerCase().trim()).filter(Boolean))];
  if (IS_TEST || recipients.length === 0) return 0;
  const { subject, text, html } = renderIncidentMail({ ...context, environment: ENV });
  for (const recipient of recipients) {
    await transporter.sendMail({ from: FROM, to: recipient, subject, text, html });
  }
  return recipients.length;
}
