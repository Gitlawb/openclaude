import { spawn, type ChildProcess } from 'node:child_process';
import { extname } from 'node:path';
import type { PluginSettings } from './types.js';
import type { ApiClient } from './api-client.js';

export type ServerStatus = 'starting' | 'ok' | 'error';
type StatusListener = (status: ServerStatus) => void;

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

    this.proc = spawn(cmd, args, { stdio: 'ignore', detached: false });
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
