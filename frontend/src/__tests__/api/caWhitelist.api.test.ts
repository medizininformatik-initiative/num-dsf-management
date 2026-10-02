/**
 * caWhitelist.api.test.ts – Tests for the admin CA-whitelist API client.
 * Verifies list/add/remove issue the right method + URL (+ body), forward the
 * bearer token, send only the keys the caller set (no totpCode in cert mode),
 * carry the TOTP code in the DELETE body, and unwrap onto res.data.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { caWhitelistApi, type CaWhitelistRow } from '../../api/caWhitelist.api';
import { useAuthStore } from '../../stores/auth.store';

beforeAll(() => {
  useAuthStore.setState({
    accessToken: 'test-token',
    user: { id: '1', email: 'admin@test.example.de' },
    isAuthenticated: true,
  });
});

let lastRequest: {
  method: string;
  pathname: string;
  authorization: string | null;
  body: unknown;
} | null = null;

async function capture(request: Request) {
  const url = new URL(request.url);
  let body: unknown = null;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const text = await request.clone().text();
    body = text ? JSON.parse(text) : null;
  }
  lastRequest = {
    method: request.method,
    pathname: url.pathname,
    authorization: request.headers.get('authorization'),
    body,
  };
}

const whitelistRow: CaWhitelistRow = {
  id: 'caw-1',
  subject_dn: 'C=DE,O=Example,CN=Example Issuing CA',
  fingerprint: 'F660B0C256481CB2BFC67661C1EA8FEEE395B7141BCAC36C36E04D08CD9E1582',
  kind: 'CLIENT',
  not_after: '2031-02-22',
  source: 'dsf-2.1.1',
  reason: null,
  added_by: 'SYSTEM:init',
  added_at: '2026-10-01T00:00:00Z',
};

const server = setupServer(
  http.get('*/admin/ca-whitelist', async ({ request }) => {
    await capture(request);
    return HttpResponse.json({ data: { whitelist: [whitelistRow], enforced: false } });
  }),
  http.post('*/admin/ca-whitelist', async ({ request }) => {
    await capture(request);
    return HttpResponse.json({ data: { id: 'caw-2' } }, { status: 201 });
  }),
  http.delete('*/admin/ca-whitelist/:id', async ({ request }) => {
    await capture(request);
    return HttpResponse.json({ data: { deleted: true } });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  lastRequest = null;
});
afterAll(() => server.close());

describe('caWhitelistApi', () => {
  it('list() GETs /admin/ca-whitelist and unwraps the whitelist and the enforcement flag', async () => {
    const res = await caWhitelistApi.list();
    expect(lastRequest?.method).toBe('GET');
    expect(lastRequest?.pathname).toMatch(/\/admin\/ca-whitelist$/);
    expect(lastRequest?.authorization).toBe('Bearer test-token');
    expect(res.data.data.whitelist[0].kind).toBe('CLIENT');
    expect(res.data.data.enforced).toBe(false);
  });

  it('add() POSTs the full body including kind, fingerprint and the totp code', async () => {
    const body = {
      subjectDn: 'C=DE,O=Example,CN=Example Root',
      kind: 'SERVER' as const,
      fingerprint: 'a'.repeat(64),
      reason: 'new federation root',
      totpCode: '123456',
    };
    const res = await caWhitelistApi.add(body);
    expect(lastRequest?.method).toBe('POST');
    expect(lastRequest?.pathname).toMatch(/\/admin\/ca-whitelist$/);
    expect(lastRequest?.authorization).toBe('Bearer test-token');
    expect(lastRequest?.body).toEqual(body);
    expect(res.status).toBe(201);
    expect(res.data.data.id).toBe('caw-2');
  });

  it('add() sends only the subject DN when nothing else is set (cert mode, no totpCode)', async () => {
    await caWhitelistApi.add({ subjectDn: 'CN=Minimal CA' });
    expect(lastRequest?.body).toEqual({ subjectDn: 'CN=Minimal CA' });
  });

  it('remove() DELETEs /admin/ca-whitelist/:id with the totp code in the body', async () => {
    const res = await caWhitelistApi.remove('caw-1', '111222');
    expect(lastRequest?.method).toBe('DELETE');
    expect(lastRequest?.pathname).toMatch(/\/admin\/ca-whitelist\/caw-1$/);
    expect(lastRequest?.body).toEqual({ totpCode: '111222' });
    expect(res.data.data.deleted).toBe(true);
  });

  it('remove() without a code sends an empty body (cert mode)', async () => {
    await caWhitelistApi.remove('caw-1');
    expect(lastRequest?.method).toBe('DELETE');
    expect(lastRequest?.body).toEqual({});
  });
});
