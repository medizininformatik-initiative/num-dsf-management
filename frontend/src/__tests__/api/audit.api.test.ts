/**
 * audit.api.test.ts – Tests for the cross-instance audit API client. Verifies
 * getCrossInstanceAudit issues GET /audit with the page/limit query params and
 * the bearer token, and returns the unwrapped { data, meta } response body.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import {
  exportCrossInstanceAudit,
  getCrossInstanceAudit,
  type AuditResponse,
} from '../../api/audit.api';
import { useAuthStore } from '../../stores/auth.store';

beforeAll(() => {
  useAuthStore.setState({
    accessToken: 'test-token',
    user: { id: '1', email: 'admin@test.de' },
    isAuthenticated: true,
  });
});

// Captures the last intercepted request so each test can assert method/URL/query.
let lastRequest: {
  method: string;
  pathname: string;
  search: URLSearchParams;
  authorization: string | null;
} | null = null;

function capture(request: Request) {
  const url = new URL(request.url);
  lastRequest = {
    method: request.method,
    pathname: url.pathname,
    search: url.searchParams,
    authorization: request.headers.get('authorization'),
  };
}

const auditBody: AuditResponse = {
  data: [
    {
      id: 'a-1',
      timestamp: '2026-03-28T00:00:00Z',
      user_email: 'admin@test.de',
      instance_id: 'inst-1',
      resource_type: 'ORGANIZATION',
      resource_id: 'ukm.de',
      operation: 'UPDATE',
      diff_json: { name: ['old', 'new'] },
      ip_address: '10.0.0.1',
      instance_label: 'inst-label',
      organization_identifier: 'ukm.de',
      organization_name: 'UKM',
    },
  ],
  meta: { total: 1, page: 2, limit: 25, isAdmin: true },
};

const server = setupServer(
  http.get('*/audit', ({ request }) => {
    capture(request);
    return HttpResponse.json(auditBody);
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  lastRequest = null;
});
afterAll(() => server.close());

describe('getCrossInstanceAudit', () => {
  it('issues GET /audit with the bearer token and returns the unwrapped body', async () => {
    const res = await getCrossInstanceAudit({ page: 2, limit: 25 });
    expect(lastRequest?.method).toBe('GET');
    expect(lastRequest?.pathname).toMatch(/\/audit$/);
    expect(lastRequest?.authorization).toBe('Bearer test-token');
    // The function returns res.data directly — the whole { data, meta } envelope.
    expect(res.data).toHaveLength(1);
    expect(res.data[0].resource_type).toBe('ORGANIZATION');
    expect(res.meta.total).toBe(1);
    expect(res.meta.isAdmin).toBe(true);
  });

  it('serialises page and limit as query-string params', async () => {
    await getCrossInstanceAudit({ page: 2, limit: 25 });
    expect(lastRequest?.search.get('page')).toBe('2');
    expect(lastRequest?.search.get('limit')).toBe('25');
  });

  it('omits absent params from the query string', async () => {
    await getCrossInstanceAudit({});
    expect(lastRequest?.search.get('page')).toBeNull();
    expect(lastRequest?.search.get('limit')).toBeNull();
  });

  it('sends set filters and drops empty / false ones', async () => {
    await getCrossInstanceAudit({
      page: 1,
      limit: 50,
      from: '2026-03-01T00:00:00.000Z',
      actor: 'alice',
      q: '',
      flaggedOnly: true,
      resource: undefined,
    });
    expect(lastRequest?.search.get('from')).toBe('2026-03-01T00:00:00.000Z');
    expect(lastRequest?.search.get('actor')).toBe('alice');
    expect(lastRequest?.search.get('flaggedOnly')).toBe('true');
    expect(lastRequest?.search.has('q')).toBe(false);
    expect(lastRequest?.search.has('resource')).toBe(false);

    await getCrossInstanceAudit({ flaggedOnly: false });
    expect(lastRequest?.search.has('flaggedOnly')).toBe(false);
  });
});

describe('exportCrossInstanceAudit', () => {
  it('requests /audit/export as a blob with the format and filters, and reads the filename', async () => {
    server.use(
      http.get('*/audit/export', ({ request }) => {
        capture(request);
        return new HttpResponse('a,b\r\n', {
          headers: {
            'Content-Type': 'text/csv',
            'Content-Disposition': 'attachment; filename="audit-all-2026-10-05.csv"',
          },
        });
      }),
    );
    const { blob, filename } = await exportCrossInstanceAudit('csv', {
      operation: 'DELETE',
      flaggedOnly: true,
    });
    expect(lastRequest?.pathname).toMatch(/\/audit\/export$/);
    expect(lastRequest?.authorization).toBe('Bearer test-token');
    expect(lastRequest?.search.get('format')).toBe('csv');
    expect(lastRequest?.search.get('operation')).toBe('DELETE');
    expect(lastRequest?.search.get('flaggedOnly')).toBe('true');
    expect(filename).toBe('audit-all-2026-10-05.csv');
    expect(blob.size).toBe(5);
  });

  it('falls back to a dated filename without a Content-Disposition header', async () => {
    server.use(http.get('*/audit/export', () => new HttpResponse('[]')));
    const { filename } = await exportCrossInstanceAudit('json', {});
    expect(filename).toMatch(/^audit-all-\d{4}-\d{2}-\d{2}\.json$/);
  });
});
