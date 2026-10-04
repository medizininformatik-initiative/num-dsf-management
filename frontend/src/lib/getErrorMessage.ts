/**
 * getErrorMessage.ts — Pull a human-readable message out of an axios error.
 * The backend wraps failures as `{ error: { code, message, details } }`, so
 * the message lives at `err.response.data.error.message`. Falls back to the
 * supplied default when the shape doesn't match (network error, non-API 500).
 *
 * For validation (400) errors the top-level message is generic ("Invalid
 * input"); the actionable per-field reason lives in `error.details[]` (Zod
 * issues with `path` + `message`). When present, surface the first issue
 * (prefixed with its field path) so the user sees something actionable.
 */
interface ZodIssueLike {
  path?: unknown;
  message?: unknown;
}
interface ApiErrorShape {
  response?: { data?: { error?: { code?: string; message?: string; details?: unknown } } };
}

/** Pull the backend's `error.code` out of an axios error, if present. */
export function getErrorCode(err: unknown): string | undefined {
  return (err as ApiErrorShape)?.response?.data?.error?.code;
}

/**
 * Like getErrorMessage, but maps the `CERT_STEP_UP_FAILED` code — returned
 * when a certificate-mode step-up re-verification fails — to `stepUpMessage`
 * instead of the (missing) backend message, before falling back to the usual
 * message/details extraction for every other error.
 */
export function getErrorMessageForStepUp(
  err: unknown,
  fallback: string,
  stepUpMessage: string,
): string {
  if (getErrorCode(err) === 'CERT_STEP_UP_FAILED') return stepUpMessage;
  return getErrorMessage(err, fallback);
}

export function getErrorMessage(err: unknown, fallback: string): string {
  const error = (err as ApiErrorShape)?.response?.data?.error;
  const baseMessage = error?.message || fallback;

  const details = error?.details;
  if (Array.isArray(details) && details.length > 0) {
    const issue = details[0] as ZodIssueLike;
    const issueMessage = typeof issue?.message === 'string' ? issue.message : '';
    if (issueMessage) {
      const path = Array.isArray(issue.path) ? issue.path.filter(Boolean).join('.') : '';
      return path ? `${path}: ${issueMessage}` : issueMessage;
    }
  }

  return baseMessage;
}

/**
 * Seconds until a rate-limited (429) request may be retried, from the
 * `Retry-After` header (nginx, express-rate-limit) or `RateLimit-Reset`
 * (express-rate-limit standard headers). Undefined when neither is usable.
 */
export function getRetryAfterSeconds(err: unknown): number | undefined {
  const headers = (err as { response?: { headers?: Record<string, unknown> } })?.response?.headers;
  if (!headers) return undefined;
  for (const name of ['retry-after', 'ratelimit-reset']) {
    const seconds = Number(headers[name]);
    if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds);
  }
  return undefined;
}
