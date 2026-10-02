/**
 * useCertificatePreview.ts — what an upload of the current PEM text would
 * register, asked from the server (POST /certificates/preview, nothing is
 * stored) about 400 ms after the text last changed, once it carries both
 * certificate markers. Text containing a private key is never sent; it is
 * reported as the private-key state right away. `blocking` is true when
 * saving would fail, so the form can disable its submit button.
 * Dependencies: usePreviewCertificate, lib/getErrorMessage, certificateUpload.
 */
import { useEffect, useRef } from 'react';
import { usePreviewCertificate } from '../../hooks/useCertificates';
import { getErrorCode } from '../../lib/getErrorMessage';
import type { CertificatePreview } from '../../api/entities.api';
import { containsPrivateKey, looksLikeCertificate } from './certificateUpload';

export const PREVIEW_DEBOUNCE_MS = 400;

export type CertificatePreviewState =
  /** Nothing that looks like a certificate yet. */
  | { kind: 'idle' }
  /** Waiting for the server; `previous` is the last result, shown dimmed. */
  | { kind: 'loading'; previous?: CertificatePreview }
  | { kind: 'privateKey' }
  | { kind: 'invalid' }
  /** The preview failed for another reason; the upload checks still apply. */
  | { kind: 'unavailable' }
  | { kind: 'ready'; preview: CertificatePreview };

export interface CertificatePreviewResult {
  state: CertificatePreviewState;
  /** Saving would be refused: disable the submit action. */
  blocking: boolean;
}

/** The upload would be refused because of the issuing CA. */
export function issuerRejected(preview: CertificatePreview): boolean {
  return preview.issuerBlacklisted || (!preview.issuerTrusted && preview.whitelistEnforced);
}

/** Guards against responses of another shape (e.g. the demo build's catch-all mock). */
function isPreview(data: unknown): data is CertificatePreview {
  const p = data as Partial<CertificatePreview> | null | undefined;
  return typeof p?.subject === 'string' && typeof p.thumbprintSha512 === 'string';
}

function resolveState(
  text: string,
  mutation: ReturnType<typeof usePreviewCertificate>,
  previous: CertificatePreview | undefined,
): CertificatePreviewState {
  if (containsPrivateKey(text)) return { kind: 'privateKey' };
  if (!looksLikeCertificate(text)) return { kind: 'idle' };
  const { variables, isPending, isError, error, data } = mutation;
  if (variables !== text || isPending) return { kind: 'loading', previous };
  if (isError) {
    const code = getErrorCode(error);
    if (code === 'PRIVATE_KEY_REJECTED') return { kind: 'privateKey' };
    if (code === 'INVALID_PEM' || code === 'VALIDATION') return { kind: 'invalid' };
    return { kind: 'unavailable' };
  }
  return isPreview(data) ? { kind: 'ready', preview: data } : { kind: 'unavailable' };
}

export function useCertificatePreview(instanceId: string, pem: string): CertificatePreviewResult {
  const mutation = usePreviewCertificate(instanceId);
  const { mutate } = mutation;
  const text = pem.trim();
  const candidate = looksLikeCertificate(text) && !containsPrivateKey(text);
  // The last good result stays visible (dimmed) while an edit is re-checked.
  const lastPreview = useRef<CertificatePreview | undefined>(undefined);

  useEffect(() => {
    if (!candidate) return;
    const timer = setTimeout(() => mutate(text), PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [candidate, text, mutate]);

  const state = resolveState(text, mutation, lastPreview.current);
  if (state.kind === 'ready') lastPreview.current = state.preview;
  else if (state.kind !== 'loading') lastPreview.current = undefined;
  const blocking =
    state.kind === 'privateKey' ||
    state.kind === 'invalid' ||
    (state.kind === 'ready' && issuerRejected(state.preview));
  return { state, blocking };
}
