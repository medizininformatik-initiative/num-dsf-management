/**
 * onboarding.template.test.ts — the downloadable CSV/XLSX onboarding templates
 * and the XLSX import path. Covers: template columns, the commented example
 * row (present, but skipped by the importer), the XLSX drop-down and Help
 * sheet, a round trip through parseOnboardingXlsx, row numbering, the
 * formula-injection and PEM guards for spreadsheet cells. No DB.
 */
import ExcelJS from 'exceljs';
import {
  ONBOARDING_COLUMNS,
  parseOnboardingFile,
  parseOnboardingXlsx,
  isXlsxUpload,
} from '../services/onboarding.service';
import { buildCsvTemplate, buildXlsxTemplate } from '../services/onboardingTemplate.service';

const FP = 'a'.repeat(128);

async function workbookBuffer(rows: (string | ExcelJS.CellValue)[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sites');
  ws.addRow([...ONBOARDING_COLUMNS]);
  rows.forEach((r) => ws.addRow(r));
  wb.addWorksheet('Help').addRow(['ignored']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('CSV template', () => {
  it('has the header row with all columns and one commented example row', () => {
    const lines = buildCsvTemplate().trim().split(/\r?\n/);
    expect(lines[0]).toBe(ONBOARDING_COLUMNS.join(','));
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('.example.de');
    expect(lines[1].startsWith('# ')).toBe(true);
  });

  it('imports nothing when uploaded untouched (the example row is a comment)', () => {
    const parsed = parseOnboardingFile(Buffer.from(buildCsvTemplate()), 'text/csv');
    expect(parsed.valid).toEqual([]);
    expect(parsed.errors).toEqual([]);
  });

  it('the example row is valid once the comment marker is removed', () => {
    const csv = buildCsvTemplate().replace('# ', '');
    const parsed = parseOnboardingFile(Buffer.from(csv), 'text/csv');
    expect(parsed.errors).toEqual([]);
    expect(parsed.valid).toHaveLength(1);
    expect(parsed.valid[0].organizationIdentifier).toBe('klinik-beispiel.example.de');
  });
});

describe('XLSX template', () => {
  it('has a Sites sheet (header, example row, country drop-down) and a Help sheet', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildXlsxTemplate()) as unknown as ExcelJS.Buffer);

    const sites = wb.getWorksheet('Sites')!;
    expect(ONBOARDING_COLUMNS.map((_, i) => sites.getCell(1, i + 1).value)).toEqual([
      ...ONBOARDING_COLUMNS,
    ]);
    expect(String(sites.getCell(2, 1).value)).toMatch(/^# .*\.example\.de$/);
    const validation = sites.getCell(5, 6).dataValidation;
    expect(validation.type).toBe('list');
    expect(validation.formulae[0]).toContain('DE');

    const help = wb.getWorksheet('Help')!;
    const documented = help.getColumn(1).values.filter((v): v is string => typeof v === 'string');
    for (const col of ONBOARDING_COLUMNS) expect(documented).toContain(col);
  });

  it('imports nothing when uploaded untouched', async () => {
    const parsed = await parseOnboardingXlsx(await buildXlsxTemplate());
    expect(parsed.valid).toEqual([]);
    expect(parsed.errors).toEqual([]);
  });
});

describe('parseOnboardingXlsx', () => {
  it('parses rows through the same validation as CSV and numbers data rows', async () => {
    const buf = await workbookBuffer([
      ['Ukm.Example.De', 'Uniklinik', 'dsf@ukm.example.de', FP, 'Muenster', 'de'],
      ['bad', 'Bad Org', 'dsf@bad.example.de', FP, '', ''],
      [],
      ['b.example.de', 'Org B', 'b@b.example.de', 'b'.repeat(128)],
    ]);
    const parsed = await parseOnboardingXlsx(buf);
    expect(parsed.valid.map((r) => r.organizationIdentifier)).toEqual([
      'ukm.example.de',
      'b.example.de',
    ]);
    expect(parsed.valid[0].countryCode).toBe('DE');
    expect(parsed.validRows).toEqual([1, 4]);
    expect(parsed.errors).toEqual([{ row: 2, issue: 'Must be a valid FQDN' }]);
  });

  it('rejects a formula cell as formula injection', async () => {
    const buf = await workbookBuffer([
      ['a.example.de', { formula: 'HYPERLINK("http://x")', result: 'x' }, 'a@a.example.de', FP],
    ]);
    const parsed = await parseOnboardingXlsx(buf);
    expect(parsed.valid).toEqual([]);
    expect(parsed.errors[0].issue).toMatch(/formula character/);
  });

  it('rejects a cell that holds a PEM block', async () => {
    const buf = await workbookBuffer([
      ['a.example.de', 'Org', 'a@a.example.de', FP, '-----BEGIN' + ' CERTIFICATE-----'],
    ]);
    await expect(parseOnboardingXlsx(buf)).rejects.toThrow('PEM_NOT_ALLOWED');
  });

  it('throws UNSUPPORTED_FORMAT for a corrupt workbook', async () => {
    await expect(parseOnboardingXlsx(Buffer.from('PK\x03\x04 not a zip'))).rejects.toThrow(
      'UNSUPPORTED_FORMAT',
    );
  });

  it('detects xlsx by content type or ZIP magic bytes', async () => {
    const buf = await buildXlsxTemplate();
    expect(isXlsxUpload(buf, undefined)).toBe(true);
    expect(isXlsxUpload(Buffer.from('a,b'), 'application/vnd.ms.spreadsheetml.x')).toBe(true);
    expect(isXlsxUpload(Buffer.from('a,b\n1,2'), 'text/csv')).toBe(false);
  });
});
