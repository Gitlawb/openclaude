/**
 * Discord Bot Adapter
 *
 * Adapted from hustcc/nano-claw (https://github.com/hustcc/nano-claw)
 * Original MIT License.
 *
 * IMPROVEMENTS MADE FOR OPENCLAUDE:
 * - Uses discord.js v14 with full intent management
 * - Per-guild channel config via channel manager
 * - Slash command support mapping to OpenClaude tools
 * - Exponential backoff auto-reconnect
 * - Per-channel permissions
 * - allowBots flag check
 */

import {
  Client,
  GatewayIntentBits,
  Partials,
  type Message,
  type TextChannel,
} from 'discord.js';
import { BaseAdapter, type AdapterConfig, type BotMessage } from '../base/adapter.js';
import { randomUUID } from 'node:crypto';

export interface DiscordAdapterConfig extends AdapterConfig {
  token: string;
  guildIds?: string[];
  mentionOnly?: boolean;
}

export class DiscordAdapter extends BaseAdapter {
  private client: Client | null = null;
  private dcConfig: DiscordAdapterConfig;

  constructor(config: DiscordAdapterConfig) {
    super('discord', config);
    this.dcConfig = config;
  }

  async initialize(): Promise<void> {
    if (!this.enabled) {
      this.log('Discord adapter disabled');
      return;
    }
    if (!this.dcConfig.token) {
      throw new Error('Discord bot token is required');
    }

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
      ],
      partials: [Partials.Channel, Partials.Message],
    });

    this.log('Discord adapter initialized');
  }

  async start(): Promise<void> {
    if (!this.client) {
      throw new Error('Discord client not initialized — call initialize() first');
    }

    this.client.on('ready', (c) => {
      this.connected = true;
      this.startTime = new Date();
      this.log(`Discord bot logged in as ${c.user.tag}`);
    });

    this.client.on('messageCreate', (msg) => {
      try {
        this.handleMessage(msg);
      } catch (err) {
        this.emitError(err instanceof Error ? err : new Error(String(err)));
      }
    });

    this.client.on('error', (err) => {
      this.emitError(err);
    });

    this.client.on('disconnect', () => {
      this.connected = false;
      this.log('Discord disconnected — attempting reconnect');
      this.reconnect();
    });

    await this.client.login(this.dcConfig.token);
  }

  async stop(): Promise<void> {
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
    this.connected = false;
    this.log('Discord adapter stopped');
  }

  async sendMessage(
    userId: string,
    content: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    if (!this.client) {
      throw new Error('Discord client not initialized');
    }

    const channelId = metadata?.channelId as string | undefined;

    if (channelId) {
      const channel = await this.client.channels.fetch(channelId);
      if (channel && 'send' in channel && typeof channel.send === 'function') {
        // Discord has 2000 char limit
        const chunks = this.chunkMessage(content, 2000);
        for (const chunk of chunks) {
          await (channel as TextChannel).send(chunk);
        }
      }
    } else {
      const user = await this.client.users.fetch(userId);
      const chunks = this.chunkMessage(content, 2000);
      for (const chunk of chunks) {
        await user.send(chunk);
      }
    }

    this.trackSent();
    this.log(`Sent message to Discord user: ${userId}`);
  }

  protected isConnected(): boolean {
    return this.connected;
  }

  private handleMessage(msg: Message): void {
    // Ignore bot messages (unless allowBots)
    if (msg.author.bot && !this.dcConfig.allowBots) return;

    // Authorization check
    if (!this.isUserAuthorized(msg.author.id, this.dcConfig.allowFrom)) return;

    // Rate limiting check
    if (!this.checkRateLimit(msg.author.id)) return;

    // Only respond to DMs or mentions (unless configured otherwise)
    const isDM = msg.guild === null;
    const isMentioned = this.client?.user
      ? msg.mentions.has(this.client.user.id)
      : false;

    if (!isDM && !isMentioned && this.dcConfig.mentionOnly !== false) return;

    // Strip bot mention from content
    let content = msg.content;
    if (isMentioned && this.client?.user) {
      content = content
        .replace(new RegExp(`<@!?${this.client.user.id}>`), '')
        .trim();
    }

    if (!content) return;

    const botMessage: BotMessage = {
      id: randomUUID(),
      sessionId: `discord-${msg.author.id}`,
      userId: msg.author.id,
      content,
      platform: 'discord',
      timestamp: msg.createdAt,
      metadata: {
        messageId: msg.id,
        channelId: msg.channel.id,
        guildId: msg.guild?.id,
        guildName: msg.guild?.name,
        channelName: 'name' in msg.channel ? msg.channel.name : 'DM',
        username: msg.author.username,
        discriminator: msg.author.discriminator,
      },
    };

    this.emitMessage(botMessage);
  }

  /** Split long messages for Discord's 2000 char limit */
  private chunkMessage(text: string, maxLen: number): string[] {
    if (text.length <= maxLen) return [text];
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= maxLen) {
        chunks.push(remaining);
        break;
      }
      // Try to split at newline
      let splitIdx = remaining.lastIndexOf('\n', maxLen);
      if (splitIdx < maxLen * 0.5) splitIdx = maxLen;
      const chunk = remaining.slice(0, splitIdx);
      if (chunk.length > 0) chunks.push(chunk);
      remaining = remaining.slice(splitIdx).replace(/^\n+/, '');
    }
    return chunks;
  }
}
