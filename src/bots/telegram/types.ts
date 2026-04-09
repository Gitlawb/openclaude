/**
 * Telegram-specific types
 */

export interface TelegramChatConfig {
  chatId: number;
  chatType: 'private' | 'group' | 'supergroup' | 'channel';
  allowFrom?: string[];
  silent?: boolean;
  allowedTools?: string[];
}

export interface TelegramGroupPermissions {
  chatId: number;
  allowedUsers: string[];
  adminOnly: boolean;
  maxMessageLength: number;
  allowedCommands: string[];
}
