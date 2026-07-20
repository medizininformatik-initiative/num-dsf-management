/**
 * onboarding.api.test.ts – Tests for the admin bulk onboarding import API
 * client. Verifies importOnboarding() sends the file's raw text with the
 * right Content-Type (text/csv vs application/json, by file name/type) and
 * returns the server's response unwrapped onto data.data.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { importOnboarding, type OnboardingImportResult } from '../../api/onboarding.api';
import { useAuthStore } from '../../stores/auth.store';

// jsdom (this project's vitest test environment) does not implement
// File.prototype.text(); polyfill it via FileReader (which jsdom does
// support) so importOnboarding's `await file.text()` call has something to
// resolve. Guarded so this is a no-op wherever the method already exists
// (e.g. a real browser, or a future jsdom release).
if (typeof File.prototype.text !== 'function') {
  File.prototype.text = function (this: File) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(this);
    });
  };
}

beforeAll(() => {
  useAuthStore.setState({
    accessToken: 'test-token',
    user: { id: '1', email: 'admin@test.de' },
    isAuthenticated: true,
  });
});

// Captures the last intercepted request so each test can assert method/URL/
// content-type/body without relying on JSON.parse (the CSV case isn't JSON).
let lastRequest: {
  method: string;
  pathname: string;
  authorization: string | null;
  contentType: string | null;
  body: string;
} | null = null;

async function capture(request: Request) {
  const url = new URL(request.url);
  lastRequest = {
    method: request.method,
    pathname: url.pathname,
    authorization: request.headers.get('authorization'),
    contentType: request.headers.get('content-type'),
    body: await request.clone().text(),
  };
}

const fixture: OnboardingImportResult = {
  summary: { created: 1, updated: 0, failed: 0 },
  rows: [{ identifier: 'ukm.de', action: 'created', ok: true }],
  parseErrors: [],
};

const server = setupServer(
  http.post('*/admin/onboarding/import', async ({ request }) => {
    await capture(request);
    return HttpResponse.json({ data: fixture });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  lastRequest = null;
});
afterAll(() => server.close());

describe('importOnboarding', () => {
  it('posts a .csv file as text/csv with the raw file text', async () => {
    const csv = 'organizationIdentifier,organizationName\nukm.de,UKM';
    const file = new File([csv], 'sites.csv', { type: 'text/csv' });

    const result = await importOnboarding(file);

    expect(lastRequest?.method).toBe('POST');
    expect(lastRequest?.pathname).toMatch(/\/admin\/onboarding\/import$/);
    expect(lastRequest?.authorization).toBe('Bearer test-token');
    expect(lastRequest?.contentType).toBe('text/csv');
    expect(lastRequest?.body).toBe(csv);
    expect(result).toEqual(fixture);
  });

  it('posts a .json file as application/json with the raw file text', async () => {
    const json = JSON.stringify([{ organizationIdentifier: 'ukm.de' }]);
    const file = new File([json], 'sites.json', { type: 'application/json' });

    const result = await importOnboarding(file);

    expect(lastRequest?.contentType).toBe('application/json');
    expect(lastRequest?.body).toBe(json);
    expect(result).toEqual(fixture);
  });

  it('treats a JSON mime type without a .json extension as JSON', async () => {
    const json = JSON.stringify({ organizationIdentifier: 'ukm.de' });
    const file = new File([json], 'upload', { type: 'application/json' });

    await importOnboarding(file);

    expect(lastRequest?.contentType).toBe('application/json');
    expect(lastRequest?.body).toBe(json);
  });

  it('falls back to text/csv for anything that is not JSON', async () => {
    const csv = 'a,b\n1,2';
    const file = new File([csv], 'data.txt', { type: 'text/plain' });

    await importOnboarding(file);

    expect(lastRequest?.contentType).toBe('text/csv');
    expect(lastRequest?.body).toBe(csv);
  });
});
