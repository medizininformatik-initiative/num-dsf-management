/**
 * incident-export-nis2.test.ts – The incident export as a BSI form filling
 * aid: JSON `bsiFormAid` and the CSV carry one section per NIS2 stage in the
 * order of BSIG § 32 with due date, "provisional" marker and the report
 * fields; the awareness time is exported as became_aware_at.
 * Pure test: no database.
 * Dependencies: incident-export.service
 */
import {
  incidentExportCsv,
  nis2FormAid,
  type IncidentExport,
} from '../services/incident-export.service';
import type { ApiIncident } from '../services/incidents.service';

const d = (iso: string) => new Date(iso);

function incident(): ApiIncident {
  return {
    id: 'i-1',
    title: 'Compromised BPE',
    description: 'details',
    status: 'CONFIRMED',
    escalationLevel: 2,
    organization: { identifier: 'site.example.de', name: 'Site' },
    reportedBy: 'reporter@site.example.de',
    reportedByOrganization: null,
    reportedAt: d('2026-11-10T09:00:00Z'),
    detectedAt: d('2026-11-10T08:00:00Z'),
    confirmedBy: null,
    confirmedAt: null,
    closedBy: null,
    closedAt: null,
    suspended: false,
    zulipUrl: null,
    nis2: [
      {
        stage: 'EARLY_WARNING',
        dueAt: d('2026-11-11T08:00:00Z'),
        provisional: false,
        reportedAt: d('2026-11-10T20:00:00Z'),
        reportedBy: 'admin@imi.example.de',
        fields: { suspectedMalicious: 'yes', crossBorder: 'no', affectedServices: 'BPE' },
      },
      {
        stage: 'NOTIFICATION',
        dueAt: d('2026-11-13T08:00:00Z'),
        provisional: false,
        reportedAt: null,
        reportedBy: null,
        fields: { severity: 'high' },
      },
      {
        stage: 'INTERIM_REPORT',
        dueAt: null,
        provisional: false,
        reportedAt: null,
        reportedBy: null,
        requestedAt: d('2026-11-12T10:00:00Z'),
        requestedBy: 'admin@imi.example.de',
        fields: null,
      },
      {
        stage: 'FINAL_REPORT',
        dueAt: d('2026-12-13T08:00:00Z'),
        provisional: true,
        reportedAt: null,
        reportedBy: null,
        fields: { rootCause: 'Phishing, "quoted"' },
      },
    ],
    dpoInformed: null,
    canAcknowledge: true,
    isMine: false,
    archivedAt: null,
    archivedBy: null,
  };
}

const doc = (): IncidentExport => ({
  exportedAt: d('2026-11-11T00:00:00Z'),
  exportedBy: 'admin@imi.example.de',
  incident: incident(),
  events: [],
  chain: { valid: true, brokenAt: null, tamperedFields: [] },
  bsiFormAid: nis2FormAid(incident()),
});

describe('nis2FormAid', () => {
  it('lists the stages in the order of the law with their fields in form order', () => {
    const aid = nis2FormAid(incident());
    expect(aid.map((s) => s.stage)).toEqual([
      'EARLY_WARNING',
      'NOTIFICATION',
      'INTERIM_REPORT',
      'FINAL_REPORT',
    ]);
    expect(aid[0].fields).toEqual({
      suspectedMalicious: 'yes',
      crossBorder: 'no',
      affectedServices: 'BPE',
    });
    // Fields not filled yet are listed empty so the aid shows what is missing.
    expect(aid[1].fields).toEqual({ severity: 'high', impact: '', iocs: '' });
    expect(aid[2].fields).toBeNull();
    expect(aid[2].requestedAt).toEqual(d('2026-11-12T10:00:00Z'));
    expect(aid[3]).toMatchObject({ provisional: true, dueAt: d('2026-12-13T08:00:00Z') });
  });
});

describe('incidentExportCsv', () => {
  const lines = incidentExportCsv(doc()).split('\r\n');
  const value = (key: string) => lines.find((l) => l.startsWith(`${key},`))?.slice(key.length + 1);

  it('exports the awareness time and a section per stage in order', () => {
    expect(value('became_aware_at')).toBe('2026-11-10T08:00:00.000Z');
    expect(lines.some((l) => l.startsWith('detected_at,'))).toBe(false);
    const order = lines.map((l) => l.split(',')[0]).filter((k) => /^nis2_[a-z_]+_due_at$/.test(k));
    expect(order).toEqual([
      'nis2_early_warning_due_at',
      'nis2_notification_due_at',
      'nis2_interim_report_due_at',
      'nis2_final_report_due_at',
    ]);
  });

  it('exports the report fields per stage, the provisional marker and the interim request', () => {
    expect(value('nis2_early_warning_suspected_malicious')).toBe('yes');
    expect(value('nis2_early_warning_affected_services')).toBe('BPE');
    expect(value('nis2_notification_severity')).toBe('high');
    expect(value('nis2_notification_impact')).toBe('');
    expect(value('nis2_interim_report_requested_at')).toBe('2026-11-12T10:00:00.000Z');
    expect(value('nis2_final_report_provisional')).toBe('true');
    expect(value('nis2_final_report_root_cause')).toBe('"Phishing, ""quoted"""');
  });
});
