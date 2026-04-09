/**
 * Channel Manager — runtime registry, persistence, CLI integration
 *
 * NEW FILE — no direct nano-claw source.
 * Provides dynamic add/remove/configure of channels at runtime
 * without restarting the gateway.
 *
 * Features:
 * - JSON persistence (~/.openclaude/channels.json)
 * - Zod schema validation
 * - Event emission for hot-reload
 * - Permission management per channel
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { z } from 'zod';
import { EventEmitter } from 'node:events';

// ─── Zod Schemas ────────────────────────────────────────────────────────────

const ChannelPlatformSchema = z.enum(['telegram', 'discord']);

const ChannelConfigSchema = z.object({
  id: z.string().min(1),
  platform: ChannelPlatformSchema,
  enabled: z.boolean().default(true),
  name: z.string().optional(),
  allowFrom: z.array(z.string()).default([]),
  allowBots: z.boolean().default(false),
  permissions: z
    .object({
      allowedUsers: z.array(z.string()).default([]),
      allowedRoles: z.array(z.string()).default([]),
      adminOnly: z.boolean().default(false),
      maxMessageLength: z.number().int().positive().default(4000),
    })
    .default({}),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

const ChannelRegistrySchema = z.object({
  version: z.literal(1).default(1),
  channels: z.array(ChannelConfigSchema).default([]),
});

export type ChannelConfig = z.infer<typeof ChannelConfigSchema>;
export type ChannelRegistry = z.infer<typeof ChannelRegistrySchema>;
export type ChannelPlatform = z.infer<typeof ChannelPlatformSchema>;

// ─── Channel Manager ────────────────────────────────────────────────────────

export class ChannelManager extends EventEmitter {
  private configPath: string;
  private registry: ChannelRegistry;

  constructor(configDir?: string) {
    super();
    const dir = configDir ?? join(homedir(), '.openclaude');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.configPath = join(dir, 'channels.json');
    this.registry = this.load();
  }

  /** Add a channel */
  addChannel(config: Omit<ChannelConfig, 'createdAt' | 'updatedAt'>): ChannelConfig {
    const parsed = ChannelConfigSchema.parse(config);

    if (this.registry.channels.some((c) => c.id === parsed.id)) {
      throw new Error(`Channel ${parsed.id} already exists`);
    }

    const now = new Date().toISOString();
    const channel: ChannelConfig = {
      ...parsed,
      createdAt: now,
      updatedAt: now,
    };

    this.registry.channels.push(channel);
    this.save();
    this.emit('channel:added', channel);
    console.log(`[channel-manager] Added channel: ${parsed.platform}/${parsed.id}`);
    return channel;
  }

  /** Remove a channel */
  removeChannel(id: string): boolean {
    const idx = this.registry.channels.findIndex((c) => c.id === id);
    if (idx === -1) return false;

    const removed = this.registry.channels.splice(idx, 1)[0];
    this.save();
    this.emit('channel:removed', removed);
    console.log(`[channel-manager] Removed channel: ${removed.platform}/${id}`);
    return true;
  }

  /** Update channel config */
  configureChannel(
    id: string,
    updates: Partial<Omit<ChannelConfig, 'id' | 'platform' | 'createdAt'>>,
  ): ChannelConfig {
    const channel = this.registry.channels.find((c) => c.id === id);
    if (!channel) throw new Error(`Channel ${id} not found`);

    Object.assign(channel, updates, { updatedAt: new Date().toISOString() });
    ChannelConfigSchema.parse(channel); // re-validate
    this.save();
    this.emit('channel:updated', channel);
    console.log(`[channel-manager] Updated channel: ${channel.platform}/${id}`);
    return channel;
  }

  /** List all channels */
  listChannels(platform?: ChannelPlatform): ChannelConfig[] {
    if (platform) {
      return this.registry.channels.filter((c) => c.platform === platform);
    }
    return [...this.registry.channels];
  }

  /** Get a specific channel */
  getChannel(id: string): ChannelConfig | undefined {
    return this.registry.channels.find((c) => c.id === id);
  }

  /** Get channels by platform */
  getChannelsByPlatform(platform: ChannelPlatform): ChannelConfig[] {
    return this.registry.channels.filter((c) => c.platform === platform);
  }

  /** Enable/disable a channel */
  setEnabled(id: string, enabled: boolean): void {
    this.configureChannel(id, { enabled });
  }

  /** Get registry */
  getRegistry(): ChannelRegistry {
    return { ...this.registry, channels: [...this.registry.channels] };
  }

  // ─── Persistence ─────────────────────────────────────────────────────────

  private load(): ChannelRegistry {
    try {
      if (existsSync(this.configPath)) {
        const raw = readFileSync(this.configPath, 'utf-8');
        const json = JSON.parse(raw);
        return ChannelRegistrySchema.parse(json);
      }
    } catch (err) {
      console.warn('[channel-manager] Failed to load registry, starting fresh:', err);
    }
    return { version: 1, channels: [] };
  }

  private save(): void {
    const data = JSON.stringify(this.registry, null, 2);
    writeFileSync(this.configPath, data, 'utf-8');
  }
}

// Singleton
let channelManager: ChannelManager | null = null;

export function getChannelManager(configDir?: string): ChannelManager {
  if (!channelManager) {
    channelManager = new ChannelManager(configDir);
  }
  return channelManager;
}
