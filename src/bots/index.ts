/**
 * Bots module — main entry point
 *
 * Re-exports everything for clean imports:
 *   import { BotGateway, TelegramAdapter, ... } from './bots'
 */

// Base
export { BaseAdapter } from './base/adapter.js';
export type { BotMessage, BotStatus, AdapterConfig } from './base/adapter.js';

// Telegram
export { TelegramAdapter } from './telegram/adapter.js';
export type { TelegramAdapterConfig } from './telegram/adapter.js';

// Discord
export { DiscordAdapter } from './discord/adapter.js';
export type { DiscordAdapterConfig } from './discord/adapter.js';

// Gateway
export { BotGateway, getBotGateway } from './manager.js';
export type { GatewayConfig } from './manager.js';

// Channel Manager
export { ChannelManager, getChannelManager } from './channel-manager.js';
export type { ChannelConfig, ChannelRegistry, ChannelPlatform } from './channel-manager.js';

// Health
export { buildHealthReport } from './health.js';
export type { HealthReport } from './health.js';

// Bus
export { MessageBus } from '../bus/index.js';
export type { MessageHandler } from '../bus/index.js';
