import { spawn, type ChildProcess } from 'node:child_process';
import { extname } from 'node:path';
import type { PluginSettings } from './types.js';
import type { ApiClient } from './api-client.js';

export type ServerStatus = 'starting' | 'ok' | 'error';
type StatusListener = (status: ServerStatus) => void;

/** Build the env object to pass when spawning the server process.
 *  Returns undefined for the Anthropic provider (inherit OS env as-is). */
export function buildServerEnv(settings: PluginSettings): NodeJS.ProcessEnv | undefined {
  const { provider, braveApiKey } = settings;
  if (!provider || provider.type === 'anthropic') return undefined;

  // For Ollama and OpenAI-compatible providers, use the OpenAI shim path.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CLAUDE_CODE_USE_OPENAI: '1',
  };
  if (provider.baseUrl) env.OPENAI_BASE_URL  = provider.baseUrl;
  if (provider.apiKey)  env.OPENAI_API_KEY   = provider.apiKey;
  if (provider.model)   env.OPENCLAUDE_MODEL = provider.model;
  if (braveApiKey)      env.BRAVE_API_KEY    = braveApiKey;
  return env;
}

export class ServerManager {
  private proc: ChildProcess | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private restartCount = 0;
  private readonly maxRestarts = 3;
  private statusListeners: StatusListener[] = [];

  constructor(private readonly settings: PluginSettings, private readonly api: ApiClient) {}

  onStatus(fn: StatusListener): void {
    this.statusListeners.push(fn);
  }

  offStatus(fn: StatusListener): void {
    this.statusListeners = this.statusListeners.filter(l => l !== fn);
  }

  private emit(status: ServerStatus): void {
    this.statusListeners.forEach(fn => fn(status));
  }

  isRunning(): boolean {
    return this.proc !== null && !this.proc.killed;
  }

  async start(): Promise<void> {
    if (this.isRunning()) return;
    this.emit('starting');

    const { serverBinaryPath, port } = this.settings;
    const isMjs = extname(serverBinaryPath) === '.mjs';
    const cmd  = isMjs ? 'node' : serverBinaryPath;
    const args = isMjs
      ? [serverBinaryPath, 'serve', '--port', String(port)]
      : ['serve', '--port', String(port)];

    const env = buildServerEnv(this.settings);
    this.proc = spawn(cmd, args, {
      stdio: 'ignore',
      detached: false,
      ...(env ? { env } : {}),
    });
    this.proc.on('exit', (code) => this.onExit(code));

    await this.api.connect();
    this.startHealthPoll();
  }

  stop(): void {
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null; }
    if (this.healthTimer) { clearInterval(this.healthTimer); this.healthTimer = null; }
    if (this.proc) { this.proc.kill(); this.proc = null; }
    this.restartCount = 0;
    this.emit('error');
  }

  private startHealthPoll(): void {
    this.healthTimer = setInterval(async () => {
      try {
        await this.api.health();
        this.emit('ok');
      } catch {
        this.emit('error');
      }
    }, 5_000);
  }

  private onExit(_code: number | null): void {
    this.proc = null;
    this.emit('error');
    if (this.restartCount < this.maxRestarts) {
      this.restartCount++;
      this.restartTimer = setTimeout(() => this.start(), 2_000 * this.restartCount);
    }
  }
}
