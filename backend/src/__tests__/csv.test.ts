/**
 * csv.test.ts — pure tests for parseCsv, the minimal RFC-4180 CSV parser
 * backing the admin bulk-upload feature. Covers plain rows, quoted fields
 * with embedded commas/newlines, escaped quotes, CRLF line endings, ragged
 * rows, and a trailing blank line. No DB.
 */
import { parseCsv } from '../lib/csv';

describe('parseCsv', () => {
  it('parses a header row and two data rows into objects', () => {
    const text = 'name,email\nAlice,alice@example.com\nBob,bob@example.com';
    expect(parseCsv(text)).toEqual([
      { name: 'Alice', email: 'alice@example.com' },
      { name: 'Bob', email: 'bob@example.com' },
    ]);
  });

  it('keeps a comma inside a quoted field', () => {
    const text = 'name,note\n"Acme, Inc.",ok';
    expect(parseCsv(text)).toEqual([{ name: 'Acme, Inc.', note: 'ok' }]);
  });

  it('keeps a newline inside a quoted field as part of one field', () => {
    const text = 'name,note\n"line1\nline2",ok';
    expect(parseCsv(text)).toEqual([{ name: 'line1\nline2', note: 'ok' }]);
  });

  it('parses \\r\\n line endings the same as \\n', () => {
    const text = 'name,email\r\nAlice,alice@example.com\r\nBob,bob@example.com';
    expect(parseCsv(text)).toEqual([
      { name: 'Alice', email: 'alice@example.com' },
      { name: 'Bob', email: 'bob@example.com' },
    ]);
  });

  it('unescapes a doubled quote inside a quoted field', () => {
    const text = 'q\n"she said ""hi"""';
    expect(parseCsv(text)).toEqual([{ q: 'she said "hi"' }]);
  });

  it('ignores a trailing blank line', () => {
    const text = 'name,email\nAlice,alice@example.com\n';
    expect(parseCsv(text)).toEqual([{ name: 'Alice', email: 'alice@example.com' }]);
  });

  it('trims header names but returns values as-is', () => {
    const text = ' name , email \n Alice , alice@example.com ';
    expect(parseCsv(text)).toEqual([{ name: ' Alice ', email: ' alice@example.com ' }]);
  });

  it('fills missing trailing fields with an empty string', () => {
    const text = 'a,b,c\n1,2';
    expect(parseCsv(text)).toEqual([{ a: '1', b: '2', c: '' }]);
  });

  it('ignores extra fields beyond the header', () => {
    const text = 'a,b\n1,2,3';
    expect(parseCsv(text)).toEqual([{ a: '1', b: '2' }]);
  });
});
