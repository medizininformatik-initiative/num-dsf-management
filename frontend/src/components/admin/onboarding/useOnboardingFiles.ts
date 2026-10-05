/**
 * useOnboardingFiles.ts – state of the multi-file upload: the file list with
 * per-file parse status, adding files (limits and pre-checks per file, each
 * file parsed on the server one after another), and removing a file together
 * with the rows it contributed. Parsed rows are merged into the page's
 * editor rows, tagged with their source file.
 * Dependencies: useOnboardingImport (useOnboardingParse), onboardingColumns,
 * onboardingFiles, sonner, i18n store.
 */
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { useOnboardingParse } from '../../../hooks/useOnboardingImport';
import { useI18n } from '../../../stores/i18n.store';
import {
  MAX_ONBOARDING_ROWS,
  isBlankCells,
  newEditorRow,
  type EditorRow,
} from './onboardingColumns';
import {
  MAX_ONBOARDING_FILES,
  MAX_ONBOARDING_TOTAL_BYTES,
  fileKindOf,
  onboardingErrorKey,
  preCheckFile,
  type OnboardingFileEntry,
} from './onboardingFiles';

export const FILE_EXIT_MS = 180;

let fileCounter = 0;

export function useOnboardingFiles(rows: EditorRow[], onRowsChange: (rows: EditorRow[]) => void) {
  const { t } = useI18n();
  const parser = useOnboardingParse();
  const [files, setFiles] = useState<OnboardingFileEntry[]>([]);
  const [removing, setRemoving] = useState<Set<string>>(() => new Set());
  const [parsing, setParsing] = useState(false);
  // Latest rows for the sequential merge below (state would be stale in the loop).
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const filesRef = useRef(files);
  filesRef.current = files;

  const patch = (id: string, change: Partial<OnboardingFileEntry>) =>
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...change } : f)));

  async function parseOne(entry: OnboardingFileEntry, file: File) {
    patch(entry.id, { status: 'parsing' });
    try {
      const parsed = await parser.mutateAsync(file);
      const kept = rowsRef.current.filter((r) => !isBlankCells(r.cells));
      if (kept.length + parsed.rows.length > MAX_ONBOARDING_ROWS) {
        patch(entry.id, { status: 'error', errorKey: 'adminOnboardingErrorTooManyRows' });
        return;
      }
      const source = { id: entry.id, name: entry.name };
      const added = parsed.rows.map((r) =>
        newEditorRow(
          {
            organizationIdentifier: r.organizationIdentifier,
            organizationName: r.organizationName,
            contactEmail: r.contactEmail,
            clientCertFingerprint: r.clientCertFingerprint,
            city: r.city ?? '',
            countryCode: r.countryCode ?? '',
          },
          source,
        ),
      );
      const next = [...kept, ...added];
      rowsRef.current = next;
      onRowsChange(next);
      patch(entry.id, { status: 'done', rowCount: added.length, skipped: parsed.parseErrors });
    } catch (err: unknown) {
      patch(entry.id, {
        status: 'error',
        errorKey: onboardingErrorKey(err) ?? 'onbFileErrParse',
      });
    }
  }

  async function addFiles(list: File[]) {
    if (list.length === 0) return;
    const room = MAX_ONBOARDING_FILES - filesRef.current.length;
    if (list.length > room) toast.error(t('onbFileErrCount', { max: MAX_ONBOARDING_FILES }));
    let total = filesRef.current.reduce((sum, f) => sum + f.size, 0);
    const accepted: { entry: OnboardingFileEntry; file: File }[] = [];
    for (const file of list.slice(0, Math.max(room, 0))) {
      fileCounter += 1;
      const entry: OnboardingFileEntry = {
        id: `file-${fileCounter}`,
        name: file.name,
        size: file.size,
        kind: fileKindOf(file.name),
        status: 'queued',
        rowCount: 0,
        skipped: [],
      };
      const bad = preCheckFile(file);
      if (bad) {
        entry.status = 'error';
        entry.errorKey = bad;
      } else if (total + file.size > MAX_ONBOARDING_TOTAL_BYTES) {
        entry.status = 'error';
        entry.errorKey = 'onbFileErrTotal';
      } else {
        total += file.size;
        accepted.push({ entry, file });
      }
      setFiles((prev) => [...prev, entry]);
    }
    setParsing(true);
    for (const { entry, file } of accepted) await parseOne(entry, file);
    setParsing(false);
  }

  function removeFile(id: string) {
    setRemoving((prev) => new Set(prev).add(id));
    window.setTimeout(() => {
      setFiles((prev) => prev.filter((f) => f.id !== id));
      setRemoving((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      if (rowsRef.current.some((r) => r.source?.id === id)) {
        const next = rowsRef.current.filter((r) => r.source?.id !== id);
        rowsRef.current = next;
        onRowsChange(next);
      }
    }, FILE_EXIT_MS);
  }

  function reset() {
    setFiles([]);
    setRemoving(new Set());
  }

  return { files, removing, parsing, addFiles, removeFile, reset };
}
