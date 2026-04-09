/**
 * Message Bus — lightweight message routing between channels and agent
 *
 * Adapted from hustcc/nano-claw (https://github.com/hustcc/nano-claw)
 * Original MIT License.
 *
 * Changes: Simplified for OpenClaude integration, removed pino dependency
 * (uses console instead, matching OpenClaude's logging approach).
 */

import { EventEmitter } from 'node:events';
import type { BotMessage } from '../bots/base/adapter.js';

export type MessageHandler = (message: BotMessage) => Promise<void>;

export class MessageBus extends EventEmitter {
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private globalHandlers: Set<MessageHandler> = new Set();

  /** Subscribe to messages from a specific platform */
  subscribe(platform: string, handler: MessageHandler): void {
    if (!this.handlers.has(platform)) {
      this.handlers.set(platform, new Set());
    }
    this.handlers.get(platform)!.add(handler);
  }

  /** Subscribe to all messages */
  subscribeAll(handler: MessageHandler): void {
    this.globalHandlers.add(handler);
  }

  /** Unsubscribe from a specific platform */
  unsubscribe(platform: string, handler: MessageHandler): void {
    this.handlers.get(platform)?.delete(handler);
  }

  /** Unsubscribe from all */
  unsubscribeAll(handler: MessageHandler): void {
    this.globalHandlers.delete(handler);
  }

  /** Publish a message to all subscribers */
  async publish(message: BotMessage): Promise<void> {
    this.emit('message', message);
    this.emit(`message:${message.platform}`, message);

    // Platform-specific handlers
    const platformHandlers = this.handlers.get(message.platform);
    if (platformHandlers) {
      await Promise.allSettled(
        [...platformHandlers].map((h) => this.safeCall(h, message)),
      );
    }

    // Global handlers
    await Promise.allSettled(
      [...this.globalHandlers].map((h) => this.safeCall(h, message)),
    );
  }

  /** Clear all handlers */
  clear(): void {
    this.handlers.clear();
    this.globalHandlers.clear();
    this.removeAllListeners();
  }

  private async safeCall(handler: MessageHandler, message: BotMessage): Promise<void> {
    try {
      await handler(message);
    } catch (err) {
      console.error('[bus] Handler error:', err);
      this.emit('error', { error: err, message });
    }
  }
}
