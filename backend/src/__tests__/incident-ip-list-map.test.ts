/**
 * incident-ip-list-map.test.ts – The IP address list (used for firewalls)
 * and the network map follow the allow list: a site suspended by an
 * incident, or whose every certificate is blocked, is in neither.
 * Dependencies: db, exceljs, uuid, helpers/allowListSites, excel.service,
 *               network.service, incident-blocks.service
 */
import ExcelJS from 'exceljs';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection';
import { generateIpAddressListExcel } from '../services/excel.service';
import { getNetworkMap } from '../services/network.service';
import { blockFingerprints } from '../services/incident-blocks.service';
import { sha512FingerprintFromPem } from '../lib/certFingerprint';
import { removeSites, seedSite, type Site } from './helpers/allowListSites';

const sites: Site[] = [];
const incidentIds: string[] = [];
const ipOf = new Map<string, string>();

async function siteWithIp(label: string, ip: string): Promise<Site> {
  const site = await seedSite({ label });
  sites.push(site);
  await db('endpoint_ips').insert({ id: uuidv4(), endpoint_id: site.endpointIds[0], ip });
  ipOf.set(site.orgId, ip);
  return site;
}

async function incidentFor(site: Site, suspended: boolean): Promise<string> {
  const id = uuidv4();
  const now = new Date();
  await db('incidents').insert({
    id,
    organization_id: site.orgId,
    title: 'test',
    description: 'test',
    status: 'CONFIRMED',
    reported_by: 'test@imi-test.example.de',
    reported_at: now,
    detected_at: now,
    confirmed_at: now,
    suspended: suspended ? 1 : 0,
  });
  incidentIds.push(id);
  return id;
}

async function listedIps(): Promise<string[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(
    (await generateIpAddressListExcel()) as unknown as Parameters<typeof wb.xlsx.load>[0],
  );
  const ips: string[] = [];
  wb.getWorksheet('IP Address List')!.eachRow((row, n) => {
    if (n > 1) ips.push(String(row.getCell(5).value));
  });
  return ips;
}

let normal: Site;
let suspended: Site;
let blocked: Site;

beforeAll(async () => {
  normal = await siteWithIp('inc-ip-normal', '10.77.0.1');
  suspended = await siteWithIp('inc-ip-suspended', '10.77.0.2');
  blocked = await siteWithIp('inc-ip-blocked', '10.77.0.3');
  await incidentFor(suspended, true);
  const blocking = await incidentFor(blocked, false);
  await blockFingerprints(db, [sha512FingerprintFromPem(blocked.certPem!)], blocking, 'test');
});

afterAll(async () => {
  await db('blocked_certificate_thumbprints').whereIn('incident_id', incidentIds).del();
  await db('incidents').whereIn('id', incidentIds).del();
  await removeSites(sites);
});

describe('IP address list and network map under incidents', () => {
  it('leaves suspended and fully blocked sites out of the IP address list', async () => {
    const ips = await listedIps();
    expect(ips).toContain(ipOf.get(normal.orgId));
    expect(ips).not.toContain(ipOf.get(suspended.orgId));
    expect(ips).not.toContain(ipOf.get(blocked.orgId));
  });

  it('leaves suspended and fully blocked sites off the network map', async () => {
    for (const isAdmin of [true, false]) {
      const ids = (await getNetworkMap({ isAdmin })).organizations.map(
        (o: { identifier: string }) => o.identifier,
      );
      expect(ids).toContain(normal.orgId);
      expect(ids).not.toContain(suspended.orgId);
      expect(ids).not.toContain(blocked.orgId);
    }
  });
});
