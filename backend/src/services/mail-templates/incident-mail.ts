/**
 * incident-mail.ts – Notification mail of the incident register, German and
 * English in one message. It names the incident title, the affected site, the
 * escalation level and links to the portal. The reporter's description is
 * never part of the mail: it stays in the portal, visible to admins and the
 * reporter only.
 * Pure: no transport. Dependencies: lib/escapeHtml.
 */
import { escapeHtml as esc } from '../../lib/escapeHtml';

/** `measures`: the sites are told about measures that did not withdraw the site. */
export type IncidentMailEvent =
  | 'reported'
  | 'confirmed'
  | 'suspended'
  | 'measures'
  | 'lifted'
  | 'closed';

export interface IncidentMailContext {
  event: IncidentMailEvent;
  environment: string;
  title: string;
  /** Affected site as "Name (identifier)", or null when unknown. */
  site: string | null;
  escalationLevel: number;
  actor: string;
  /** Allow-list version published by a suspension or its lifting. */
  versionNumber?: number | null;
  link: string;
}

const SUBJECT: Record<IncidentMailEvent, { de: string; en: string }> = {
  reported: { de: 'Sicherheitsvorfall gemeldet', en: 'Security incident reported' },
  confirmed: { de: 'Sicherheitsvorfall bestätigt', en: 'Security incident confirmed' },
  suspended: { de: 'Standort gesperrt', en: 'Site suspended' },
  measures: { de: 'Maßnahmen gegen einen Standort', en: 'Measures taken against a site' },
  lifted: { de: 'Sperre aufgehoben', en: 'Suspension lifted' },
  closed: { de: 'Sicherheitsvorfall abgeschlossen', en: 'Security incident closed' },
};

const INTRO: Record<IncidentMailEvent, { de: string; en: string }> = {
  reported: {
    de: 'Ein Sicherheitsvorfall wurde im DSF Management Tool gemeldet und wartet auf Bestätigung.',
    en: 'A security incident was reported in the DSF Management Tool and awaits confirmation.',
  },
  confirmed: {
    de: 'Ein Sicherheitsvorfall wurde bestätigt. Bitte prüfen Sie, ob Ihr Standort betroffen ist.',
    en: 'A security incident was confirmed. Please check whether your site is affected.',
  },
  suspended: {
    de: 'Der betroffene Standort wurde gesperrt und aus der Allow List genommen.',
    en: 'The affected site was suspended and taken out of the allow list.',
  },
  measures: {
    de: 'Gegen den betroffenen Standort wurden Maßnahmen ergriffen (zum Beispiel gesperrte Zertifikate oder entfernte Logins). Details stehen im Portal.',
    en: 'Measures were taken against the affected site (for example blocked certificates or removed logins). The details are in the portal.',
  },
  lifted: {
    de: 'Die Sperre des Standorts wurde aufgehoben. Gesperrte Zertifikate bleiben gesperrt.',
    en: 'The suspension of the site was lifted. Blocked certificates stay blocked.',
  },
  closed: {
    de: 'Der Sicherheitsvorfall wurde abgeschlossen.',
    en: 'The security incident was closed.',
  },
};

export function renderIncidentMail(ctx: IncidentMailContext): {
  subject: string;
  text: string;
  html: string;
} {
  const s = SUBJECT[ctx.event];
  const intro = INTRO[ctx.event];
  const site = ctx.site ?? 'unbekannt / unknown';
  const rows: Array<[string, string]> = [
    ['Vorfall / Incident', ctx.title],
    ['Standort / Site', site],
    ['Eskalationsstufe / Escalation level', String(ctx.escalationLevel)],
    ['Durch / By', ctx.actor],
  ];
  if (ctx.versionNumber) {
    rows.push(['Allow-List-Version / Allow list version', `v${ctx.versionNumber}`]);
  }
  const subject = `[DSF Management Tool – ${ctx.environment}] ${s.de} / ${s.en}: ${ctx.title}`;
  const text = [
    `DSF Management Tool – ${ctx.environment}`,
    '',
    intro.de,
    intro.en,
    '',
    ...rows.map(([label, value]) => `${label}: ${value}`),
    '',
    `Details im Portal / Details in the portal: ${ctx.link}`,
  ].join('\n');
  const html = `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#1a1a2e;">
      <h2 style="color:#ef4444;margin-bottom:4px;">DSF Management Tool – ${esc(ctx.environment)}</h2>
      <h3 style="margin-top:0;color:#333;">${esc(s.de)} / ${esc(s.en)}</h3>
      <p>${esc(intro.de)}</p>
      <p style="color:#666;">${esc(intro.en)}</p>
      <table style="border-collapse:collapse;width:100%;font-size:14px;">
        ${rows
          .map(
            ([label, value]) =>
              `<tr><td style="padding:6px 12px 6px 0;color:#666;">${esc(label)}</td><td style="padding:6px 0;font-weight:bold;">${esc(value)}</td></tr>`,
          )
          .join('')}
      </table>
      <p style="margin-top:20px;">
        <a href="${esc(ctx.link)}" style="display:inline-block;padding:10px 20px;background:#ef4444;color:#fff;border-radius:6px;text-decoration:none;font-weight:bold;">
          Im Portal öffnen / Open in portal
        </a>
      </p>
    </div>
  `;
  return { subject, text, html };
}
