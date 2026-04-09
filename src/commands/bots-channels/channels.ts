/**
 * Channels management command implementation
 *
 * Usage:
 *   /channels list              — List all configured channels
 *   /channels add <id> <platform> — Add a channel
 *   /channels remove <id>       — Remove a channel
 *   /channels status            — Show channel statuses
 *   /channels enable <id>       — Enable a channel
 *   /channels disable <id>      — Disable a channel
 */

import type { LocalCommandCall, LocalCommandResult } from '../../types/command.js';
import { getChannelManager, type ChannelPlatform } from '../../bots/channel-manager.js';

export const call: LocalCommandCall = async (args, _context): Promise<LocalCommandResult> => {
  const parts = args.trim().split(/\s+/);
  const action = parts[0] || 'list';
  const cm = getChannelManager();

  switch (action) {
    case 'list':
      return listChannels(cm, parts[1]);
    case 'add':
      return addChannel(cm, parts[1], parts[2] as ChannelPlatform);
    case 'remove':
      return removeChannel(cm, parts[1]);
    case 'status':
      return channelStatus(cm);
    case 'enable':
      return toggleChannel(cm, parts[1], true);
    case 'disable':
      return toggleChannel(cm, parts[1], false);
    default:
      return {
        type: 'text',
        value: `Unknown action: ${action}\n\nUsage: /channels [list|add|remove|status|enable|disable]`,
      } satisfies LocalCommandResult;
  }
};

function listChannels(
  cm: ReturnType<typeof getChannelManager>,
  platform?: string,
): LocalCommandResult {
  const channels = cm.listChannels(platform as ChannelPlatform | undefined);

  if (channels.length === 0) {
    return {
      type: 'text',
      value: platform
        ? `No ${platform} channels configured.`
        : 'No channels configured. Use `/channels add <id> <telegram|discord>` to add one.',
    } satisfies LocalCommandResult;
  }

  const lines = channels.map((c) => {
    const icon = c.enabled ? '🟢' : '🔴';
    return `  ${icon} ${c.id} (${c.platform})${c.name ? ` — ${c.name}` : ''}`;
  });

  return {
    type: 'text',
    value: `📋 Channels (${channels.length}):\n\n${lines.join('\n')}`,
  } satisfies LocalCommandResult;
}

function addChannel(
  cm: ReturnType<typeof getChannelManager>,
  id?: string,
  platform?: ChannelPlatform,
): LocalCommandResult {
  if (!id || !platform) {
    return {
      type: 'text',
      value: 'Usage: /channels add <id> <telegram|discord>',
    } satisfies LocalCommandResult;
  }

  if (!['telegram', 'discord'].includes(platform)) {
    return {
      type: 'text',
      value: `Invalid platform: ${platform}. Must be 'telegram' or 'discord'.`,
    } satisfies LocalCommandResult;
  }

  try {
    cm.addChannel({
      id,
      platform,
      enabled: true,
      allowFrom: [],
      allowBots: false,
      permissions: { allowedUsers: [], allowedRoles: [], adminOnly: false, maxMessageLength: 4000 },
      metadata: {},
    });
    return {
      type: 'text',
      value: `✅ Added channel: ${id} (${platform})`,
    } satisfies LocalCommandResult;
  } catch (err) {
    return {
      type: 'text',
      value: `❌ ${err instanceof Error ? err.message : String(err)}`,
    } satisfies LocalCommandResult;
  }
}

function removeChannel(
  cm: ReturnType<typeof getChannelManager>,
  id?: string,
): LocalCommandResult {
  if (!id) {
    return { type: 'text', value: 'Usage: /channels remove <id>' } satisfies LocalCommandResult;
  }

  const removed = cm.removeChannel(id);
  return {
    type: 'text',
    value: removed
      ? `🗑️  Removed channel: ${id}`
      : `Channel not found: ${id}`,
  } satisfies LocalCommandResult;
}

function channelStatus(cm: ReturnType<typeof getChannelManager>): LocalCommandResult {
  const channels = cm.listChannels();

  if (channels.length === 0) {
    return { type: 'text', value: 'No channels configured.' } satisfies LocalCommandResult;
  }

  const lines = channels.map((c) => {
    const icon = c.enabled ? '🟢' : '🔴';
    const perms = c.permissions.adminOnly ? ' (admin only)' : '';
    const users = c.allowFrom.length > 0 ? ` [${c.allowFrom.length} users]` : '';
    return `  ${icon} ${c.id} (${c.platform})${perms}${users}`;
  });

  return {
    type: 'text',
    value: `📊 Channel Status:\n\n${lines.join('\n')}`,
  } satisfies LocalCommandResult;
}

function toggleChannel(
  cm: ReturnType<typeof getChannelManager>,
  id?: string,
  enabled = true,
): LocalCommandResult {
  if (!id) {
    return {
      type: 'text',
      value: `Usage: /channels ${enabled ? 'enable' : 'disable'} <id>`,
    } satisfies LocalCommandResult;
  }

  try {
    cm.setEnabled(id, enabled);
    return {
      type: 'text',
      value: `${enabled ? '✅ Enabled' : '⏸️  Disabled'} channel: ${id}`,
    } satisfies LocalCommandResult;
  } catch (err) {
    return {
      type: 'text',
      value: `❌ ${err instanceof Error ? err.message : String(err)}`,
    } satisfies LocalCommandResult;
  }
}
