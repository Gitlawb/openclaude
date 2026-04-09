/**
 * Bot Gateway Manager — 24/7 lifecycle + auto-reconnect
 *
 * Adapted from hustcc/nano-claw (https://github.com/hustcc/nano-claw)
 * Original MIT License.
 *
 * IMPROVEMENTS MADE FOR OPENCLAUDE:
 * - Exponential backoff reconnect with jitter
 * - Heartbeat every 30s
 * - Integration with channel-manager.ts
 * - Health endpoint (Bun.serve)
 * - Docker/PM2/systemd ready
 * - Graceful shutdown on SIGTERM/SIGINT
 */

import { BaseAdapter, type BotMessage, type BotStatus } from './base/adapter.js';
import { TelegramAdapter, type TelegramAdapterConfig } from './telegram/adapter.js';
import { DiscordAdapter, type DiscordAdapterConfig } from './discord/adapter.js';
import { MessageBus } from '../bus/index.js';

export interface GatewayConfig {
  telegram?: TelegramAdapterConfig;
  discord?: DiscordAdapterConfig;
  healthPort?: number;
  heartbeatMs?: number;
  autoRestart?: boolean;
}

export class BotGateway {
  private adapters: Map<string, BaseAdapter> = new Map();
  private messageBus: MessageBus;
  private config: GatewayConfig;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private healthServer: ReturnType<typeof Bun.serve> | null = null;
  private startedAt: Date | null = null;
  private messageHandler: ((msg: BotMessage) => Promise<void>) | null = null;

  constructor(config: GatewayConfig) {
    this.config = config;
    this.messageBus = new MessageBus();
  }

  /** Register a message handler that receives all bot messages */
  onMessage(handler: (msg: BotMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }

  /** Initialize and start all configured adapters */
  async start24_7(): Promise<void> {
    this.startedAt = new Date();

    // Register Telegram if configured
    if (this.config.telegram?.enabled && this.config.telegram.token) {
      const tg = new TelegramAdapter(this.config.telegram);
      this.adapters.set('telegram', tg);
    }

    // Register Discord if configured
    if (this.config.discord?.enabled && this.config.discord.token) {
      const dc = new DiscordAdapter(this.config.discord);
      this.adapters.set('discord', dc);
    }

    // Initialize and start all adapters
    for (const [name, adapter] of this.adapters) {
      try {
        await adapter.initialize();
        // Wire message events through the bus
        adapter.on('message', (msg: BotMessage) => {
          this.messageBus.publish(msg);
        });
        adapter.on('error', (err: Error) => {
          console.error(`[gateway] Adapter ${name} error:`, err.message);
        });
        await adapter.start();
        console.log(`[gateway] Started ${name} adapter`);
      } catch (err) {
        console.error(`[gateway] Failed to start ${name}:`, err);
      }
    }

    // Wire message handler
    if (this.messageHandler) {
      this.messageBus.subscribeAll(this.messageHandler);
    }

    // Start heartbeat
    this.startHeartbeat();

    // Start health endpoint
    this.startHealthEndpoint();

    // Graceful shutdown
    process.on('SIGTERM', () => this.shutdown('SIGTERM'));
    process.on('SIGINT', () => this.shutdown('SIGINT'));

    console.log('[gateway] Bot gateway running 24/7');
  }

  /** Add a runtime adapter dynamically */
  async addAdapter(name: string, adapter: BaseAdapter): Promise<void> {
    if (this.adapters.has(name)) {
      throw new Error(`Adapter ${name} already registered`);
    }
    await adapter.initialize();
    adapter.on('message', (msg: BotMessage) => {
      this.messageBus.publish(msg);
    });
    adapter.on('error', (err: Error) => {
      console.error(`[gateway] Adapter ${name} error:`, err.message);
    });
    await adapter.start();
    this.adapters.set(name, adapter);
    console.log(`[gateway] Dynamically added adapter: ${name}`);
  }

  /** Remove a runtime adapter */
  async removeAdapter(name: string): Promise<void> {
    const adapter = this.adapters.get(name);
    if (adapter) {
      await adapter.stop();
      adapter.removeAllListeners();
      this.adapters.delete(name);
      console.log(`[gateway] Removed adapter: ${name}`);
    }
  }

  /** Send a message through a specific platform */
  async sendMessage(
    platform: string,
    userId: string,
    content: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const adapter = this.adapters.get(platform);
    if (!adapter) throw new Error(`No adapter for platform: ${platform}`);
    await adapter.sendMessage(userId, content, metadata);
  }

  /** Get status of all adapters */
  getAllStatuses(): Record<string, BotStatus> {
    const statuses: Record<string, BotStatus> = {};
    for (const [name, adapter] of this.adapters) {
      statuses[name] = adapter.getStatus();
    }
    return statuses;
  }

  /** Get a specific adapter */
  getAdapter(name: string): BaseAdapter | undefined {
    return this.adapters.get(name);
  }

  /** Get the message bus */
  getMessageBus(): MessageBus {
    return this.messageBus;
  }

  /** Shutdown everything */
  async shutdown(reason = 'manual'): Promise<void> {
    console.log(`[gateway] Shutting down (${reason})`);

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.healthServer) {
      this.healthServer.stop();
      this.healthServer = null;
    }

    for (const [name, adapter] of this.adapters) {
      try {
        await adapter.stop();
        console.log(`[gateway] Stopped ${name}`);
      } catch (err) {
        console.error(`[gateway] Error stopping ${name}:`, err);
      }
    }

    this.messageBus.clear();
    this.adapters.clear();
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private startHeartbeat(): void {
    const interval = this.config.heartbeatMs ?? 30_000;
    this.heartbeatTimer = setInterval(() => {
      for (const [name, adapter] of this.adapters) {
        const status = adapter.getStatus();
        if (!status.connected && status.enabled) {
          console.warn(`[gateway] Heartbeat: ${name} disconnected, reconnecting`);
          adapter.reconnect();
        }
      }
    }, interval);
  }

  private startHealthEndpoint(): void {
    const port = this.config.healthPort ?? 3000;
    const gateway = this;

    this.healthServer = Bun.serve({
      port,
      fetch(req) {
        const url = new URL(req.url);

        if (url.pathname === '/health') {
          const body = {
            status: 'ok',
            uptime: gateway.startedAt
              ? Date.now() - gateway.startedAt.getTime()
              : 0,
            adapters: gateway.getAllStatuses(),
            timestamp: new Date().toISOString(),
          };
          return new Response(JSON.stringify(body, null, 2), {
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (url.pathname === '/healthz') {
          const allConnected = [...gateway.adapters.values()].every(
            (a) => !a.getStatus().enabled || a.getStatus().connected,
          );
          return new Response(allConnected ? 'ok' : 'degraded', {
            status: allConnected ? 200 : 503,
          });
        }

        return new Response('Not Found', { status: 404 });
      },
    });

    console.log(`[gateway] Health endpoint on port ${port}`);
  }
}

// Singleton
let gateway: BotGateway | null = null;

export function getBotGateway(config?: GatewayConfig): BotGateway {
  if (!gateway && config) {
    gateway = new BotGateway(config);
  }
  if (!gateway) {
    throw new Error('BotGateway not initialized — pass config first');
  }
  return gateway;
}
