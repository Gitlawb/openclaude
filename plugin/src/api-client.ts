import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import type { ChatRequest, HealthStatus, PendingEdit, Session, SseEvent, VaultInfo } from './types.js';
import { parseSseBuffer } from './sse-parser.js';

export class ApiClient {
  private readonly baseUrl: string;
  private readonly resolvedTokenPath: string;
  private token = '';

  constructor(port: number, tokenPath: string) {
    this.baseUrl = `http://127.0.0.1:${port}`;
    this.resolvedTokenPath = tokenPath.replace(/^~/, homedir());
  }

  private readToken(): string {
    try { return readFileSync(this.resolvedTokenPath, 'utf8').trim(); } catch { return ''; }
  }

  async connect(): Promise<void> {
    this.token = this.readToken();
  }

  private authHeaders(): Record<string, string> {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` };
  }

  async health(): Promise<HealthStatus> {
    const res = await fetch(`${this.baseUrl}/health`);
    if (!res.ok) throw new Error(`health check failed: ${res.status}`);
    return res.json() as Promise<HealthStatus>;
  }

  async listSessions(retried = false): Promise<Session[]> {
    const res = await fetch(`${this.baseUrl}/sessions`, { headers: this.authHeaders() });
    if (res.status === 401 && !retried) { this.token = this.readToken(); return this.listSessions(true); }
    if (!res.ok) throw new Error(`list sessions failed: ${res.status}`);
    return res.json() as Promise<Session[]>;
  }

  async deleteSession(id: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/sessions/${id}`, { method: 'DELETE', headers: this.authHeaders() });
    if (!res.ok) throw new Error(`delete session failed: ${res.status}`);
  }

  async listPendingEdits(): Promise<PendingEdit[]> {
    const res = await fetch(`${this.baseUrl}/pending-edits`, { headers: this.authHeaders() });
    if (!res.ok) throw new Error(`list pending edits failed: ${res.status}`);
    return res.json() as Promise<PendingEdit[]>;
  }

  async applyEdit(id: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/pending-edits/${id}/apply`, {
      method: 'POST', headers: this.authHeaders(), body: JSON.stringify({}),
    });
    if (!res.ok) throw new Error(`apply edit failed: ${res.status}`);
  }

  async rejectEdit(id: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/pending-edits/${id}/reject`, {
      method: 'POST', headers: this.authHeaders(), body: JSON.stringify({}),
    });
    if (!res.ok) throw new Error(`reject edit failed: ${res.status}`);
  }

  async listVaults(): Promise<VaultInfo[]> {
    const res = await fetch(`${this.baseUrl}/vaults`, { headers: this.authHeaders() });
    if (!res.ok) throw new Error(`list vaults failed: ${res.status}`);
    return res.json() as Promise<VaultInfo[]>;
  }

  async chat(req: ChatRequest, onEvent: (evt: SseEvent) => void, signal?: AbortSignal): Promise<void> {
    const res = await fetch(`${this.baseUrl}/chat`, {
      method: 'POST', headers: this.authHeaders(), body: JSON.stringify(req), signal,
    });
    if (!res.ok) throw new Error(`chat failed: ${res.status}`);
    if (!res.body) throw new Error('no response body');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { events, remaining } = parseSseBuffer(buffer);
        buffer = remaining;
        for (const evt of events) onEvent(evt);
      }
    } finally {
      reader.releaseLock();
    }
  }
}
