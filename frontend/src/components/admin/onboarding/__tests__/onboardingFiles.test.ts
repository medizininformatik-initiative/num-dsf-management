/**
 * onboardingFiles.test.ts – the multi-file helpers: per-file pre-check, error
 * code mapping, conflict detection across merged rows, and the per-file split
 * of an import result.
 */
import { describe, it, expect } from 'vitest';
import {
  findConflicts,
  onboardingErrorKey,
  preCheckFile,
  summarizeByFile,
  MAX_ONBOARDING_FILE_BYTES,
} from '../onboardingFiles';
import { emptyCells, newEditorRow, type EditorRow } from '../onboardingColumns';

const row = (id: string, fp: string, file?: string): EditorRow =>
  newEditorRow(
    { ...emptyCells(), organizationIdentifier: id, clientCertFingerprint: fp },
    file ? { id: `f-${file}`, name: file } : undefined,
  );

describe('preCheckFile', () => {
  it('accepts csv, xlsx and json by extension, case-insensitively', () => {
    for (const n of ['a.csv', 'b.XLSX', 'c.json']) {
      expect(preCheckFile(new File(['x'], n))).toBeNull();
    }
  });

  it('rejects other types, empty files and oversized files', () => {
    expect(preCheckFile(new File(['x'], 'notes.txt'))).toBe('onbFileErrType');
    expect(preCheckFile(new File([], 'a.csv'))).toBe('adminOnboardingErrorEmptyBody');
    const big = new File(['x'], 'a.csv');
    Object.defineProperty(big, 'size', { value: MAX_ONBOARDING_FILE_BYTES + 1 });
    expect(preCheckFile(big)).toBe('adminOnboardingErrorFileTooLarge');
  });
});

describe('onboardingErrorKey', () => {
  it('maps backend codes and ignores unknown ones', () => {
    const err = (code: string) => ({ response: { data: { error: { code } } } });
    expect(onboardingErrorKey(err('PEM_NOT_ALLOWED'))).toBe('adminOnboardingErrorPemNotAllowed');
    expect(onboardingErrorKey(err('NOPE'))).toBeUndefined();
    expect(onboardingErrorKey(new Error('x'))).toBeUndefined();
  });
});

describe('findConflicts', () => {
  it('flags both rows of a repeated identifier, ignoring case and blanks', () => {
    const rows = [
      row('A.example.de', 'a'.repeat(128), 'one.csv'),
      newEditorRow(),
      row('a.example.de', 'b'.repeat(128), 'two.csv'),
      row('c.example.de', 'c'.repeat(128)),
    ];
    const c = findConflicts(rows);
    expect(Object.keys(c)).toEqual(['0', '2']);
    expect(c[0]).toEqual({ kind: 'identifier', others: [{ row: 3, file: 'two.csv' }] });
    expect(c[2].others).toEqual([{ row: 1, file: 'one.csv' }]);
  });

  it('flags one fingerprint under different identifiers, not under the same one', () => {
    const fp = 'ab:'.repeat(64);
    const c = findConflicts([row('a.example.de', fp), row('b.example.de', fp.toUpperCase())]);
    expect(c[0].kind).toBe('fingerprint');
    expect(c[1].kind).toBe('fingerprint');
    expect(findConflicts([row('a.example.de', fp), row('c.example.de', 'd'.repeat(128))])).toEqual(
      {},
    );
  });
});

describe('summarizeByFile', () => {
  it('counts per source file and leaves typed rows out', () => {
    const sources = [
      { id: '1', name: 'a.csv' },
      { id: '2', name: 'b.csv' },
      undefined,
      { id: '2', name: 'b.csv' },
    ];
    const items = summarizeByFile(
      {
        rows: [
          { identifier: 'x', action: 'created', ok: true, row: 1 },
          { identifier: 'y', action: 'updated', ok: true, row: 2 },
          { identifier: 'z', action: 'created', ok: true, row: 3 },
          { identifier: 'w', action: 'failed', ok: false, row: 4 },
        ],
        parseErrors: [{ row: 1, issue: 'bad' }],
      },
      sources,
    );
    expect(items).toEqual([
      { id: '1', name: 'a.csv', created: 1, updated: 0, failed: 1 },
      { id: '2', name: 'b.csv', created: 0, updated: 1, failed: 1 },
    ]);
  });
});
