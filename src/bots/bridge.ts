/**
 * Bot-to-MCP Bridge
 *
 * Connects the Bot Gateway (src/bots/) with the MCP Channel Notification
 * system (src/services/mcp/). When a bot message arrives via Telegram/Discord,
 * it can be routed into the agent's channel notification pipeline. When the
 * agent sends a channel reply, it can be forwarded to the bot gateway.
 *
 * This is the integration layer neither PR #524 nor #551 had.
 */

import type { BotMessage } from './base/adapter.js';
import type { BotGateway } from './manager.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BridgeConfig {
  /** Whether to forward bot messages into MCP channel notifications */
  forwardBotToMcp: boolean;
  /** Whether to forward MCP replies to bot gateway */
  forwardMcpToBot: boolean;
  /** Platform mapping — which bot platforms map to which MCP channel plugin names */
  platformMapping: Record<string, string>;
}

const DEFAULT_CONFIG: BridgeConfig = {
  forwardBotToMcp: true,
  forwardMcpToBot: true,
  platformMapping: {
    telegram: 'plugin:telegram',
    discord: 'plugin:discord',
  },
};

// ─── Bridge ──────────────────────────────────────────────────────────────────

export class BotMcpBridge {
  private config: BridgeConfig;
  private gateway: BotGateway | null = null;
  private onMcpReply: ((channelId: string, content: string) => void) | null = null;

  constructor(config?: Partial<BridgeConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Attach a bot gateway to the bridge */
  attachGateway(gateway: BotGateway): void {
    this.gateway = gateway;

    if (this.config.forwardBotToMcp) {
      gateway.onMessage(async (msg: BotMessage) => {
        this.routeToMcp(msg);
      });
    }
  }

  /** Register a callback for when MCP replies should go back to the bot */
  onReply(callback: (channelId: string, content: string) => void): void {
    this.onMcpReply = callback;
  }

  /** Route a bot message into the MCP channel pipeline */
  private async routeToMcp(msg: BotMessage): Promise<void> {
    const mcpSource = this.config.platformMapping[msg.platform];
    if (!mcpSource) {
      console.log(`[bridge] No MCP mapping for platform: ${msg.platform}`);
      return;
    }

    // The message can be consumed by the existing channel notification system
    // which listens for messages from MCP channel plugins. The bot gateway
    // acts as a virtual channel plugin source.
    console.log(
      `[bridge] Bot → MCP: ${msg.platform}/${msg.userId}: ${msg.content.slice(0, 80)}`
    );

    // Emit the message for any registered MCP consumers
    this.emitBridgeEvent('bot:message', {
      ...msg,
      mcpSource,
    });
  }

  /** Forward an MCP reply back through the bot gateway */
  async forwardReply(platform: string, userId: string, content: string, metadata?: Record<string, unknown>): Promise<void> {
    if (!this.config.forwardMcpToBot) return;
    if (!this.gateway) {
      console.log('[bridge] No gateway attached, cannot forward reply');
      return;
    }

    console.log(
      `[bridge] MCP → Bot: ${platform}/${userId}: ${content.slice(0, 80)}`
    );

    try {
      await this.gateway.sendMessage(platform, userId, content, metadata);
    } catch (err) {
      console.error('[bridge] Failed to forward reply:', err);
    }
  }

  /** Internal event emitter for bridge events */
  private listeners: Map<string, Set<(data: any) => void>> = new Map();

  on(event: string, handler: (data: any) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
  }

  off(event: string, handler: (data: any) => void): void {
    this.listeners.get(event)?.delete(handler);
  }

  private emitBridgeEvent(event: string, data: any): void {
    for (const handler of this.listeners.get(event) ?? []) {
      try {
        handler(data);
      } catch (err) {
        console.error(`[bridge] Event handler error for ${event}:`, err);
      }
    }
  }
}
