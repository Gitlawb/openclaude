import { describe, expect, it, beforeEach, mock } from 'bun:test';

// Mock node modules BEFORE importing ApiClient
mock.module('node:fs', () => ({ readFileSync: () => 'test-token-123' }));
mock.module('node:os', () => ({ homedir: () => '/home/testuser' }));

import { ApiClient } from '../src/api-client.js';

type MockResponse = Pick<Response, 'ok' | 'status' | 'json' | 'body'>;

function makeFetch(status: number, body: unknown): typeof fetch {
  return mock(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    body: null,
  } as MockResponse as Response));
}

describe('ApiClient', () => {
  let client: ApiClient;

  beforeEach(async () => {
    client = new ApiClient(7777, '~/.openclaude/server-token');
    await client.connect();
  });

  it('health() returns parsed body on 200', async () => {
    global.fetch = makeFetch(200, { status: 'ok', version: '0.1.7', uptime_ms: 1234 });
    const h = await client.health();
    expect(h.status).toBe('ok');
    expect(h.version).toBe('0.1.7');
  });

  it('health() throws on non-200', async () => {
    global.fetch = makeFetch(503, {});
    await expect(client.health()).rejects.toThrow('503');
  });

  it('listSessions() sends Authorization header', async () => {
    let capturedHeaders: Record<string, string> = {};
    global.fetch = mock(async (_url: unknown, init?: RequestInit) => {
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
      return { ok: true, status: 200, json: async () => [] } as unknown as Response;
    });
    await client.listSessions();
    expect(capturedHeaders['Authorization']).toBe('Bearer test-token-123');
  });

  it('listSessions() retries once on 401 with refreshed token', async () => {
    let calls = 0;
    global.fetch = mock(async () => {
      calls++;
      const status = calls === 1 ? 401 : 200;
      return { ok: status === 200, status, json: async () => [] } as unknown as Response;
    });
    const result = await client.listSessions();
    expect(result).toEqual([]);
    expect(calls).toBe(2);
  });

  it('listPendingEdits() returns array from server', async () => {
    const payload = [{ id: 'e1', file: '/v/note.md', vault: '/v', sessionId: 's1', reason: 'fix', before: 'a', after: 'b', createdAt: 1 }];
    global.fetch = makeFetch(200, payload);
    const edits = await client.listPendingEdits();
    expect(edits).toHaveLength(1);
    expect(edits[0].id).toBe('e1');
  });

  it('applyEdit() POSTs to /pending-edits/:id/apply', async () => {
    let url = '';
    global.fetch = mock(async (u: unknown) => { url = u as string; return { ok: true, status: 200, json: async () => ({}) } as unknown as Response; });
    await client.applyEdit('edit-abc');
    expect(url).toContain('/pending-edits/edit-abc/apply');
  });

  it('rejectEdit() POSTs to /pending-edits/:id/reject', async () => {
    let url = '';
    global.fetch = mock(async (u: unknown) => { url = u as string; return { ok: true, status: 200, json: async () => ({}) } as unknown as Response; });
    await client.rejectEdit('edit-xyz');
    expect(url).toContain('/pending-edits/edit-xyz/reject');
  });
});
