/**
 * excel.service.ts – IP Address List export as Excel
 * Contains ALL outgoing IPs of all organizations, as approved: per site the
 * endpoints and IPs of its latest APPROVED request (same rule as the allow
 * list), never unreviewed live edits. Sites the incident register withdraws
 * (suspended, or every certificate blocked) are left out like in the bundle.
 * Dependencies: db/connection, approved-snapshot.service, fhir.service
 */
import ExcelJS from 'exceljs';
import { db } from '../db/connection';
import {
  approvedActive,
  isSnapshotUnusable,
  loadLatestApprovedSites,
  snapshotEndpoints,
  snapshotOrgField,
  type ApprovedSite,
  type SnapshotEndpoint,
} from './approved-snapshot.service';
import { incidentWithdrawnOrganizations } from './fhir.service';

interface IpRow {
  orgIdentifier: string;
  orgName: string;
  endpointIdentifier: string;
  endpointAddress: string;
  ip: string;
  isFhir: boolean;
  isBpe: boolean;
}

/** Live endpoints and IPs, only for sites whose approved request has no usable snapshot. */
async function liveEndpoints(sites: ApprovedSite[]): Promise<Map<string, SnapshotEndpoint[]>> {
  const byOrg = new Map<string, SnapshotEndpoint[]>();
  if (sites.length === 0) return byOrg;
  const endpoints: Array<{ identifier: string; organization_id: string; address: string }> =
    await db('endpoints').whereIn(
      'organization_id',
      sites.map((s) => s.orgIdentifier),
    );
  const ips: Array<{ endpoint_id: string; ip: string; is_fhir: unknown; is_bpe: unknown }> =
    endpoints.length > 0
      ? await db('endpoint_ips').whereIn(
          'endpoint_id',
          endpoints.map((e) => e.identifier),
        )
      : [];
  for (const ep of endpoints) {
    const list = byOrg.get(ep.organization_id) ?? [];
    list.push({
      identifier: ep.identifier,
      name: null,
      address: ep.address,
      ips: ips
        .filter((ip) => ip.endpoint_id === ep.identifier)
        .map((ip) => ({ ip: ip.ip, is_fhir: !!ip.is_fhir, is_bpe: !!ip.is_bpe })),
    });
    byOrg.set(ep.organization_id, list);
  }
  return byOrg;
}

const text = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

async function loadIpRows(): Promise<IpRow[]> {
  // Firewall allow-list parity with fhir.service.generateFullBundle: only IPs
  // of sites that are active in their latest APPROVED request, taken from
  // that request's snapshot. A newer pending/rejected/withdrawn request does
  // not drop a site, an unsubmitted live edit does not add an IP.
  // Sites the incident register withdraws are left out, as in the bundle.
  const withdrawn = await incidentWithdrawnOrganizations();
  const sites = (await loadLatestApprovedSites()).filter(
    (s) => approvedActive(s) && !withdrawn.has(s.orgIdentifier),
  );
  const live = await liveEndpoints(sites.filter((s) => isSnapshotUnusable(s.snapshot)));
  const rows: IpRow[] = [];
  for (const site of sites) {
    const orgName = snapshotOrgField(site.snapshot, 'name') ?? site.orgName;
    const endpoints = snapshotEndpoints(site.snapshot) ?? live.get(site.orgIdentifier) ?? [];
    for (const ep of endpoints) {
      for (const ip of ep.ips) {
        rows.push({
          orgIdentifier: site.orgIdentifier,
          orgName,
          endpointIdentifier: ep.identifier,
          endpointAddress: ep.address,
          ip: ip.ip,
          isFhir: ip.is_fhir,
          isBpe: ip.is_bpe,
        });
      }
    }
  }
  return rows.sort(
    (a, b) =>
      text(a.orgIdentifier, b.orgIdentifier) ||
      text(a.endpointIdentifier, b.endpointIdentifier) ||
      text(a.ip, b.ip),
  );
}

export async function generateIpAddressListExcel(): Promise<Buffer> {
  const ips = await loadIpRows();

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'DSF Allow List Management';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('IP Address List');
  sheet.columns = [
    { header: 'Organization', key: 'orgIdentifier', width: 30 },
    { header: 'Organization Name', key: 'orgName', width: 40 },
    { header: 'Endpoint', key: 'endpointIdentifier', width: 40 },
    { header: 'Endpoint URL', key: 'endpointAddress', width: 50 },
    { header: 'IP Address', key: 'ip', width: 20 },
    { header: 'FHIR', key: 'isFhir', width: 10 },
    { header: 'BPE', key: 'isBpe', width: 10 },
  ];
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6C63FF' } };
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ips.forEach((row) => {
    sheet.addRow({ ...row, isFhir: row.isFhir ? 'Yes' : 'No', isBpe: row.isBpe ? 'Yes' : 'No' });
  });
  sheet.autoFilter = { from: 'A1', to: 'G1' };
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
