/**
 * dsfTaskLink.ts – link to the draft Task of the DSF process downloadAllowList
 * on a site's own DSF FHIR server. dsf-process-allow-list installs that Task
 * (profile task-download-allow-list, status draft) on the site's server; the
 * DSF FHIR web UI renders a draft Task as a start-process form, where the user
 * pastes the allow-list link into the "allow_list" input and starts it.
 * Pure helper, no dependencies.
 */

export const TASK_PROFILE = 'http://dsf.dev/fhir/StructureDefinition/task-download-allow-list';

/**
 * Search URL of the draft download-allow-list Task on the FHIR server at
 * `fhirBase` (e.g. https://fhir.klinik.example.de/fhir), or null when the base
 * is not a plain http(s) URL. Credentials, query and fragment of the base are
 * dropped; a trailing slash is stripped.
 */
export function dsfTaskSearchUrl(fhirBase: string | null | undefined): string | null {
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
  const path = url.pathname.replace(/\/+$/, '');
  return `${url.origin}${path}/Task?_profile=${encodeURIComponent(TASK_PROFILE)}&status=draft`;
}
