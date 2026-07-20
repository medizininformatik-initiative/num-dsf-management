/**
 * csv.ts – Minimal RFC-4180 CSV parser for the admin bulk-upload feature
 * (later tasks parse CSV/JSON site rows). Single-pass state machine (no
 * regex-split, which breaks on quoted newlines/commas). The first non-empty
 * line is the header row; header names are trimmed and values are returned
 * as-is (a later Zod layer trims/validates them).
 */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  const endField = (): void => {
    row.push(field);
    field = '';
  };

  const endRow = (): void => {
    endField();
    // A line with no comma and no characters (bare line break) is blank —
    // drop it instead of emitting a one-column empty record.
    const isBlankLine = row.length === 1 && row[0] === '';
    if (!isBlankLine) rows.push(row);
    row = [];
  };

  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += ch;
        i += 1;
      }
      continue;
    }

    if (ch === '"' && field === '') {
      inQuotes = true;
      i += 1;
    } else if (ch === ',') {
      endField();
      i += 1;
    } else if (ch === '\r' && text[i + 1] === '\n') {
      endRow();
      i += 2;
    } else if (ch === '\n') {
      endRow();
      i += 1;
    } else {
      field += ch;
      i += 1;
    }
  }
  // Final record when the text doesn't end with a line break.
  if (field !== '' || row.length > 0) endRow();

  if (rows.length === 0) return [];

  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const record: Record<string, string> = {};
    header.forEach((key, idx) => {
      record[key] = r[idx] ?? '';
    });
    return record;
  });
}
