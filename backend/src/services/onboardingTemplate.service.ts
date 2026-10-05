/**
 * onboardingTemplate.service.ts – builds the downloadable bulk-onboarding
 * templates: a CSV and an XLSX with the header row, one example row that is
 * marked as a comment (its identifier starts with "#", which the importer
 * skips, so uploading an untouched template imports nothing) and, in the XLSX,
 * drop-downs for the country code plus a "Help" sheet explaining each column.
 * All example data uses .example.de.
 * Dependencies: exceljs, onboarding.service (ONBOARDING_COLUMNS)
 */
import ExcelJS from 'exceljs';
import { ONBOARDING_COLUMNS } from './onboarding.service';

const EXAMPLE_FINGERPRINT = Array.from({ length: 64 }, (_, i) =>
  ((i * 37 + 11) % 256).toString(16).padStart(2, '0'),
).join(':');

const EXAMPLE_ROW: Record<(typeof ONBOARDING_COLUMNS)[number], string> = {
  organizationIdentifier: '# klinik-beispiel.example.de',
  organizationName: 'Beispiel Klinikum (example row, delete me)',
  contactEmail: 'dsf-admin@klinik-beispiel.example.de',
  clientCertFingerprint: EXAMPLE_FINGERPRINT,
  city: 'Muenster',
  countryCode: 'DE',
};

const COUNTRIES = ['DE', 'AT', 'CH', 'NL', 'BE', 'LU', 'FR', 'IT', 'ES', 'DK', 'SE', 'PL', 'GB'];

export const COLUMN_HELP: { column: string; required: boolean; description: string }[] = [
  {
    column: 'organizationIdentifier',
    required: true,
    description:
      'Primary key of the site: its FQDN, e.g. ukm.de. Lower-cased on import. An existing identifier is updated, not duplicated.',
  },
  {
    column: 'organizationName',
    required: true,
    description:
      '1 to 255 characters. Must not start with = + - @ (spreadsheet formula characters).',
  },
  {
    column: 'contactEmail',
    required: true,
    description: "The site's login user and allow-list entry.",
  },
  {
    column: 'clientCertFingerprint',
    required: true,
    description:
      "SHA-512 fingerprint of the site's browser client certificate: 128 hex characters; colons, spaces and case are ignored. Get it with: certtool --fingerprint --hash=sha512 --infile=client_certificate.pem",
  },
  { column: 'city', required: false, description: 'Up to 100 characters.' },
  {
    column: 'countryCode',
    required: false,
    description: 'Two letters (ISO 3166-1 alpha-2), e.g. DE.',
  },
];

function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** CSV template: header row plus the commented example row. */
export function buildCsvTemplate(): string {
  const header = ONBOARDING_COLUMNS.join(',');
  const example = ONBOARDING_COLUMNS.map((c) => csvCell(EXAMPLE_ROW[c])).join(',');
  return `${header}\r\n${example}\r\n`;
}

/** XLSX template: "Sites" sheet (header, example row, validations) and "Help" sheet. */
export async function buildXlsxTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sites = wb.addWorksheet('Sites', { views: [{ state: 'frozen', ySplit: 1 }] });
  sites.columns = ONBOARDING_COLUMNS.map((key) => ({
    header: key,
    key,
    width: key === 'clientCertFingerprint' ? 60 : key === 'countryCode' ? 14 : 30,
  }));
  const head = sites.getRow(1);
  head.font = { bold: true };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };

  const example = sites.addRow(EXAMPLE_ROW);
  example.font = { italic: true, color: { argb: 'FF7A7A7A' } };
  example.getCell('clientCertFingerprint').note =
    'Example row: starts with "#" so it is ignored on import. Replace or delete it.';

  // Text format for every data cell so Excel does not turn fingerprints into numbers.
  for (let r = 3; r <= 1002; r += 1) {
    ONBOARDING_COLUMNS.forEach((_, i) => {
      sites.getCell(r, i + 1).numFmt = '@';
    });
  }
  const cc = ONBOARDING_COLUMNS.indexOf('countryCode') + 1;
  for (let r = 2; r <= 1002; r += 1) {
    sites.getCell(r, cc).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [`"${COUNTRIES.join(',')}"`],
      showErrorMessage: false,
      promptTitle: 'countryCode',
      prompt: 'Two-letter country code, e.g. DE',
      showInputMessage: true,
    };
  }
  const fp = ONBOARDING_COLUMNS.indexOf('clientCertFingerprint') + 1;
  const em = ONBOARDING_COLUMNS.indexOf('contactEmail') + 1;
  for (let r = 3; r <= 1002; r += 1) {
    sites.getCell(r, em).dataValidation = {
      type: 'custom',
      allowBlank: true,
      formulae: [`ISNUMBER(FIND("@",${sites.getCell(r, em).address}))`],
      showErrorMessage: true,
      errorTitle: 'contactEmail',
      error: 'Enter a valid e-mail address.',
    };
    sites.getCell(r, fp).dataValidation = {
      type: 'textLength',
      operator: 'greaterThanOrEqual',
      allowBlank: true,
      formulae: [128],
      showErrorMessage: true,
      errorStyle: 'warning',
      errorTitle: 'clientCertFingerprint',
      error: 'A SHA-512 fingerprint has 128 hex characters.',
    };
  }

  const help = wb.addWorksheet('Help');
  help.columns = [
    { header: 'Column', key: 'column', width: 26 },
    { header: 'Required', key: 'required', width: 12 },
    { header: 'Description', key: 'description', width: 100 },
  ];
  help.getRow(1).font = { bold: true };
  for (const h of COLUMN_HELP) {
    help.addRow({
      column: h.column,
      required: h.required ? 'yes' : 'no',
      description: h.description,
    });
  }
  help.addRow({});
  help.addRow({
    column: 'Notes',
    description:
      'Fill the "Sites" sheet, one site per row, then upload it under Administration > Onboarding. Rows whose organizationIdentifier starts with "#" are ignored. Re-uploading is safe: existing sites are updated. Never put certificates or private keys in this file.',
  });
  help.getColumn('description').alignment = { wrapText: true, vertical: 'top' };

  return Buffer.from(await wb.xlsx.writeBuffer());
}
