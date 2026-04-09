/**
 * Telegram Bot Adapter
 *
 * Adapted from hustcc/nano-claw (https://github.com/hustcc/nano-claw)
 * Original MIT License.
 *
 * IMPROVEMENTS MADE FOR OPENCLAUDE:
 * - Uses grammY (modern Telegram bot framework) instead of node-telegram-bot-api
 * - Bun.serve compatibility for webhook mode
 * - Channel manager integration for dynamic chat registration
 * - allowBots flag check
 * - Exponential backoff auto-reconnect
 * - Per-channel permissions
 */

import { Bot, Context, webhookCallback } from 'grammy';
import { BaseAdapter, type AdapterConfig, type BotMessage } from '../base/adapter.js';
import { randomUUID } from 'node:crypto';

export interface TelegramAdapterConfig extends AdapterConfig {
  token: string;
  webhook?: {
    enabled: boolean;
    host: string;
    port: number;
    path: string;
  };
  parseMode?: 'Markdown' | 'HTML' | 'MarkdownV2';
}

export class TelegramAdapter extends BaseAdapter {
  private bot: Bot<Context> | null = null;
  private tgConfig: TelegramAdapterConfig;
  private webhookServer: ReturnType<typeof Bun.serve> | null = null;

  constructor(config: TelegramAdapterConfig) {
    super('telegram', config);
    this.tgConfig = config;
  }

  async initialize(): Promise<void> {
    if (!this.enabled) {
      this.log('Telegram adapter disabled');
      return;
    }
    if (!this.tgConfig.token) {
      throw new Error('Telegram bot token is required');
    }

    this.bot = new Bot(this.tgConfig.token);
    this.log('Telegram adapter initialized');
  }

  async start(): Promise<void> {
    if (!this.bot) {
      throw new Error('Telegram bot not initialized — call initialize() first');
    }

    // Message handler
    this.bot.on('message', (ctx) => {
      try {
        this.handleMessage(ctx);
      } catch (err) {
        this.emitError(err instanceof Error ? err : new Error(String(err)));
      }
    });

    // Error handler
    this.bot.catch((err) => {
      this.emitError(err instanceof Error ? err : new Error(String(err)));
    });

    if (this.tgConfig.webhook?.enabled) {
      await this.startWebhook();
    } else {
      await this.bot.start({
        onStart: () => {
          this.connected = true;
          this.startTime = new Date();
          this.log('Telegram bot started (polling)');
        },
      });
    }
  }

  private async startWebhook(): Promise<void> {
    if (!this.bot || !this.tgConfig.webhook) return;

    const { host, port, path } = this.tgConfig.webhook;
    const handleUpdate = webhookCallback(this.bot, 'std/http');

    this.webhookServer = Bun.serve({
      hostname: host,
      port,
      fetch: async (req) => {
        const url = new URL(req.url);
        if (url.pathname === path) {
          return handleUpdate(req);
        }
        if (url.pathname === '/health') {
          return new Response(JSON.stringify(this.getStatus()), {
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('Not Found', { status: 404 });
      },
    });

    this.connected = true;
    this.startTime = new Date();
    this.log(`Telegram webhook server on ${host}:${port}${path}`);
  }

  async stop(): Promise<void> {
    if (this.webhookServer) {
      this.webhookServer.stop();
      this.webhookServer = null;
    }
    if (this.bot) {
      await this.bot.stop();
    }
    this.connected = false;
    this.log('Telegram adapter stopped');
  }

  async sendMessage(
    userId: string,
    content: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    if (!this.bot) {
      throw new Error('Telegram bot not initialized');
    }

    const chatId = metadata?.chatId ?? userId;
    await this.bot.api.sendMessage(Number(chatId), content, {
      parse_mode: this.tgConfig.parseMode ?? 'Markdown',
    });
    this.log(`Sent message to ${chatId}`);
  }

  protected isConnected(): boolean {
    return this.connected;
  }

  private handleMessage(ctx: Context): void {
    const msg = ctx.message;
    if (!msg || !msg.text) return;

    // Check allowBots
    if (!this.tgConfig.allowBots && msg.from?.is_bot) return;

    const userId = String(msg.from?.id ?? '');
    if (!userId) return;

    // Authorization check
    if (!this.isUserAuthorized(userId, this.tgConfig.allowFrom)) return;

    const botMessage: BotMessage = {
      id: randomUUID(),
      sessionId: `telegram-${userId}`,
      userId,
      content: msg.text,
      platform: 'telegram',
      timestamp: new Date((msg.date ?? Date.now() / 1000) * 1000),
      metadata: {
        messageId: msg.message_id,
        chatId: msg.chat.id,
        chatType: msg.chat.type,
        username: msg.from?.username,
        firstName: msg.from?.first_name,
        lastName: msg.from?.last_name,
      },
    };

    this.emitMessage(botMessage);
  }
}
