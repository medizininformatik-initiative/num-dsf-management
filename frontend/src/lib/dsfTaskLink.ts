/**
 * dsfTaskLink.ts – link to the draft Task of the DSF process downloadAllowList
 * on a site's own DSF FHIR server. dsf-process-allow-list installs that Task
 * (identifier task-download-allow-list, status draft) on the site's server; the
 * DSF FHIR web UI renders a draft Task as a start-process form, where the user
 * pastes the allow-list link and submits it. The search uses the identifier
 * form of the previous allow-list tool.
 * Pure helper, no dependencies.
 */

export const PLUGIN_RELEASES_URL =
  'https://github.com/datasharingframework/dsf-process-allow-list/releases';

/** Identifier system|value of the draft download-allow-list Task. */
export const TASK_IDENTIFIER =
  'http://dsf.dev/sid/task-identifier|http://dsf.dev/bpe/Process/downloadAllowList/1.0/task-download-allow-list';

/** Readable query of the Task search (the "|" and ":" stay unescaped). */
const TASK_QUERY = `identifier=${TASK_IDENTIFIER}&status=draft`;

/** Base URL of the FHIR server without trailing slash, or null when it is not a plain http(s) URL. */
function cleanBase(fhirBase: string | null | undefined): string | null {
  const raw = (fhirBase ?? '').trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

/**
 * Readable search URL of the draft download-allow-list Task on the FHIR server
 * at `fhirBase` (e.g. https://fhir.klinik.example.de/fhir) – the text shown to
 * the user – or null when the base is not a plain http(s) URL. Credentials,
 * query and fragment of the base are dropped; a trailing slash is stripped.
 */
export function dsfTaskDisplayUrl(fhirBase: string | null | undefined): string | null {
  const base = cleanBase(fhirBase);
  return base === null ? null : `${base}/Task?${TASK_QUERY}`;
}

/** Same search with the parameter value URL-encoded, for the link's href. */
export function dsfTaskSearchUrl(fhirBase: string | null | undefined): string | null {
  const base = cleanBase(fhirBase);
  if (base === null) return null;
  return `${base}/Task?identifier=${encodeURIComponent(TASK_IDENTIFIER)}&status=draft`;
}
