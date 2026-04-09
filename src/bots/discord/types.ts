/**
 * Discord-specific types
 */

export interface DiscordGuildConfig {
  guildId: string;
  guildName?: string;
  allowedChannels: string[];
  adminRoles: string[];
  mentionOnly: boolean;
  silent: boolean;
  allowedTools?: string[];
}

export interface DiscordChannelPermissions {
  channelId: string;
  guildId: string;
  allowedUsers: string[];
  allowedRoles: string[];
  maxMessageLength: number;
  rateLimitPerUser: number;
}
