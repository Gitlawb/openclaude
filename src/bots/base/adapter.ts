/**
 * Base Bot Adapter
 *
 * Adapted from hustcc/nano-claw (https://github.com/hustcc/nano-claw)
 * Original MIT License.
 *
 * IMPROVEMENTS MADE FOR OPENCLAUDE:
 * - 100% Bun-native TypeScript
 * - Reorganized into src/bots/base/ structure
 * - Deep integration with OpenClaude coordinator/tools/skills/grpc
 * - Added channel management hooks
 * - 24/7 auto-reconnect + healthchecks
 * - Per-channel permissions and dynamic registration
 * - Exponential backoff reconnect strategy
 */

import { EventEmitter } from 'node:events';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BotMessage {
  id: string;
  sessionId: string;
  userId: string;
  content: string;
  platform: 'telegram' | 'discord';
  timestamp: Date;
  metadata: Record<string, unknown>;
}

export interface BotStatus {
  type: string;
  enabled: boolean;
  connected: boolean;
  uptime: number;
  reconnectCount: number;
  lastError?: string;
}

export interface AdapterConfig {
  enabled: boolean;
  allowFrom?: string[];
  allowBots?: boolean;
  reconnect?: {
    maxRetries: number;
    baseDelayMs: number;
    maxDelayMs: number;
  };
}

// ─── Abstract Base Adapter ───────────────────────────────────────────────────

export abstract class BaseAdapter extends EventEmitter {
  protected platform: string;
  protected enabled: boolean;
  protected connected: boolean;
  protected startTime: Date | null = null;
  protected reconnectCount = 0;
  protected lastError: string | undefined;
  protected config: AdapterConfig;

  constructor(platform: string, config: AdapterConfig) {
    super();
    this.platform = platform;
    this.config = config;
    this.enabled = config.enabled;
    this.connected = false;
  }

  /** Initialize the adapter (create clients, validate config) */
  abstract initialize(): Promise<void>;

  /** Start listening for messages */
  abstract start(): Promise<void>;

  /** Gracefully stop the adapter */
  abstract stop(): Promise<void>;

  /** Send a message to a user/channel */
  abstract sendMessage(
    userId: string,
    content: string,
    metadata?: Record<string, unknown>,
  ): Promise<void>;

  /** Check underlying connection health */
  protected abstract isConnected(): boolean;

  /** Reconnect with exponential backoff */
  async reconnect(): Promise<void> {
    const { maxRetries = 10, baseDelayMs = 1000, maxDelayMs = 60000 } =
      this.config.reconnect ?? {};

    if (this.reconnectCount >= maxRetries) {
      this.lastError = `Max reconnect attempts (${maxRetries}) reached`;
      this.emit('error', new Error(this.lastError));
      return;
    }

    const delay = Math.min(
      baseDelayMs * 2 ** this.reconnectCount,
      maxDelayMs,
    );
    const jitter = Math.random() * delay * 0.3;
    const totalDelay = delay + jitter;

    this.reconnectCount++;
    this.log(
      `Reconnecting in ${Math.round(totalDelay)}ms (attempt ${this.reconnectCount}/${maxRetries})`,
    );

    await Bun.sleep(totalDelay);

    try {
      await this.stop();
      await this.start();
      this.reconnectCount = 0;
      this.log('Reconnected successfully');
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      this.log(`Reconnect failed: ${this.lastError}`);
      await this.reconnect(); // retry
    }
  }

  /** Get current status */
  getStatus(): BotStatus {
    return {
      type: this.platform,
      enabled: this.enabled,
      connected: this.isConnected(),
      uptime: this.startTime
        ? Date.now() - this.startTime.getTime()
        : 0,
      reconnectCount: this.reconnectCount,
      lastError: this.lastError,
    };
  }

  /** Emit a structured message event */
  protected emitMessage(message: BotMessage): void {
    this.log(`Message from ${message.userId}: ${message.content.slice(0, 80)}`);
    this.emit('message', message);
  }

  /** Emit an error event */
  protected emitError(error: Error): void {
    this.lastError = error.message;
    this.log(`Error: ${error.message}`);
    this.emit('error', error);
    // Trigger auto-reconnect
    this.reconnect().catch((e) => this.log(`Reconnect failed: ${e}`));
  }

  /** Check user authorization */
  protected isUserAuthorized(userId: string, allowFrom?: string[]): boolean {
    if (!allowFrom || allowFrom.length === 0) return true;
    const authorized = allowFrom.includes(userId);
    if (!authorized) {
      this.log(`Unauthorized user: ${userId}`);
    }
    return authorized;
  }

  /** Structured log */
  protected log(msg: string): void {
    console.log(`[bots:${this.platform}] ${msg}`);
  }
}
