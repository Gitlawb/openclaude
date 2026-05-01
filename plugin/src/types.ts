export interface PluginSettings {
  port: number;
  serverBinaryPath: string;
  tokenPath: string;
  autoStartServer: boolean;
  preset: 'conservative' | 'balanced' | 'aggressive';
}

export const DEFAULT_SETTINGS: PluginSettings = {
  port: 7777,
  serverBinaryPath: '',
  tokenPath: '~/.openclaude/server-token',
  autoStartServer: true,
  preset: 'balanced',
};

// Mirrors server's AgentEvent union (src/serve/handlers/chat.ts)
export type SseEvent =
  | { event: 'token';        data: { text: string } }
  | { event: 'tool_call';    data: { id: string; name: string; args: unknown } }
  | { event: 'tool_result';  data: { id: string; ok: boolean; preview?: string } }
  | { event: 'pending_edit'; data: { id: string; file: string; reason: string } }
  | { event: 'insight';      data: { text: string } }
  | { event: 'done';         data: { sessionId: string; finishReason: string } }
  | { event: 'error';        data: { code: string; message: string } };

// Mirrors server's PendingEdit (src/serve/pendingEditStore.ts)
export interface PendingEdit {
  id: string;
  file: string;
  vault: string;
  sessionId: string;
  reason?: string;
  before: string;
  after: string;
  createdAt: number;
}

export interface Session {
  id: string;
  createdAt: number;
  updatedAt: number;
}

export interface HealthStatus {
  status: 'ok' | 'error';
  version: string;
  uptime_ms: number;
}

export interface VaultInfo {
  id: string;
  name: string;
  path: string;
}

export interface ChatRequest {
  message: string;
  sessionId?: string;
  // Keys match server's AgentFn context shape
  context?: { activeNote?: string; vault?: string; selection?: string };
}
