/**
 * Channel notifications — lets an MCP server push user messages into the
 * conversation. A "channel" (Discord, Slack, SMS, etc.) is just an MCP server
 * that:
 *   - exposes tools for outbound messages (e.g. `send_message`) — standard MCP
 *   - sends `notifications/claude/channel` notifications for inbound — this file
 *
 * The notification handler wraps the content in a <channel> tag and
 * enqueues it. SleepTool polls hasCommandsInQueue() and wakes within 1s.
 * The model sees where the message came from and decides which tool to reply
 * with (the channel's MCP tool, SendUserMessage, or both).
 *
 * feature('KAIROS') || feature('KAIROS_CHANNELS') (replaced with true in
 * OpenClaude build). Runtime gate via isChannelsEnabled() — always true
 * in OpenClaude. No OAuth or org policy requirement.
 *
 * OpenClaude: allowlisted plugins (telegram, discord, imessage, fakechat)
 * pass the allowlist check automatically when listed via --channels.
 * Custom channels need --dangerously-load-development-channels.
 */

import type { ServerCapabilities } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod/v4'
import {
  type ChannelEntry,
  getAllowedChannels,
} from '../../bootstrap/state.js'
import { CHANNEL_TAG } from '../../constants/xml.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { parsePluginIdentifier } from '../../utils/plugins/pluginIdentifier.js'
import { escapeXmlAttr } from '../../utils/xml.js'
import {
  type ChannelAllowlistEntry,
  getChannelAllowlist,
  isChannelsEnabled,
} from './channelAllowlist.js'

export const ChannelMessageNotificationSchema = lazySchema(() =>
  z.object({
    method: z.literal('notifications/claude/channel'),
    params: z.object({
      content: z.string(),
      // Opaque passthrough — thread_id, user, whatever the channel wants the
      // model to see. Rendered as attributes on the <channel> tag.
      meta: z.record(z.string(), z.string()).optional(),
    }),
  }),
)

/**
 * Structured permission reply from a channel server. Servers that support
 * this declare `capabilities.experimental['claude/channel/permission']` and
 * emit this event INSTEAD of relaying "yes tbxkq" as text via
 * notifications/claude/channel. Explicit opt-in per server — a channel that
 * just wants to relay text never becomes a permission surface by accident.
 *
 * The server parses the user's reply (spec: /^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i)
 * and emits {request_id, behavior}. CC matches request_id against its
 * pending map. Unlike the regex-intercept approach, text in the general
 * channel can never accidentally match — approval requires the server
 * to deliberately emit this specific event.
 */
export const CHANNEL_PERMISSION_METHOD =
  'notifications/claude/channel/permission'
export const ChannelPermissionNotificationSchema = lazySchema(() =>
  z.object({
    method: z.literal(CHANNEL_PERMISSION_METHOD),
    params: z.object({
      request_id: z.string(),
      behavior: z.enum(['allow', 'deny']),
    }),
  }),
)

/**
 * Outbound: CC → server. Fired from interactiveHandler.ts when a
 * permission dialog opens and the server has declared the permission
 * capability. Server formats the message for its platform (Telegram
 * markdown, iMessage rich text, Discord embed) and sends it to the
 * human. When the human replies "yes tbxkq", the server parses that
 * against PERMISSION_REPLY_RE and emits the inbound schema above.
 *
 * Not a zod schema — CC SENDS this, doesn't validate it. A type here
 * keeps both halves of the protocol documented side by side.
 */
export const CHANNEL_PERMISSION_REQUEST_METHOD =
  'notifications/claude/channel/permission_request'
export type ChannelPermissionRequestParams = {
  request_id: string
  tool_name: string
  description: string
  /** JSON-stringified tool input, truncated to 200 chars with …. Full
   *  input is in the local terminal dialog; this is a phone-sized
   *  preview. Server decides whether/how to show it. */
  input_preview: string
}

/**
 * Meta keys become XML attribute NAMES — a crafted key like
 * `x="" injected="y` would break out of the attribute structure. Only
 * accept keys that look like plain identifiers. This is stricter than
 * the XML spec (which allows `:`, `.`, `-`) but channel servers only
 * send `chat_id`, `user`, `thread_ts`, `message_id` in practice.
 */
const SAFE_META_KEY = /^[a-zA-Z_][a-zA-Z0-9_]*$/

export function wrapChannelMessage(
  serverName: string,
  content: string,
  meta?: Record<string, string>,
): string {
  const attrs = Object.entries(meta ?? {})
    .filter(([k]) => SAFE_META_KEY.test(k))
    .map(([k, v]) => ` ${k}="${escapeXmlAttr(v)}"`)
    .join('')
  return `<${CHANNEL_TAG} source="${escapeXmlAttr(serverName)}"${attrs}>\n${content}\n</${CHANNEL_TAG}>`
}

/**
 * Effective allowlist for the current session. OpenClaude: simplified to
 * always return the hardcoded allowlist. Org overrides (allowedChannelPlugins)
 * are accepted if provided for forward-compatibility.
 *
 * Signature kept for backward-compat with ChannelsNotice.tsx.
 */
export function getEffectiveChannelAllowlist(
  _sub?: string,
  orgList?: ChannelAllowlistEntry[] | undefined,
): {
  entries: ChannelAllowlistEntry[]
  source: 'org' | 'ledger'
} {
  if (orgList && orgList.length > 0) {
    return { entries: orgList, source: 'org' }
  }
  return { entries: getChannelAllowlist(), source: 'ledger' }
}

export type ChannelGateResult =
  | { action: 'register' }
  | {
      action: 'skip'
      kind:
        | 'capability'
        | 'disabled'
        | 'auth'
        | 'policy'
        | 'session'
        | 'marketplace'
        | 'allowlist'
      reason: string
    }

/**
 * Match a connected MCP server against the user's parsed --channels entries.
 * server-kind is exact match on bare name; plugin-kind matches on the second
 * segment of plugin:X:Y. Returns the matching entry so callers can read its
 * kind — that's the user's trust declaration, not inferred from runtime shape.
 */
export function findChannelEntry(
  serverName: string,
  channels: readonly ChannelEntry[],
): ChannelEntry | undefined {
  // split unconditionally — for a bare name like 'slack', parts is ['slack']
  // and the plugin-kind branch correctly never matches (parts[0] !== 'plugin').
  const parts = serverName.split(':')
  return channels.find(c =>
    c.kind === 'server'
      ? serverName === c.name
      : parts[0] === 'plugin' && parts[1] === c.name,
  )
}

/**
 * Gate an MCP server's channel-notification path. Caller checks
 * feature('KAIROS') || feature('KAIROS_CHANNELS') first (build-time
 * elimination). Gate order: capability → runtime gate (isChannelsEnabled) →
 * session --channels → marketplace verification → allowlist.
 *
 * OpenClaude: OAuth and org policy gates removed. The session allowlist
 * (--channels flag) and capability check remain as the security boundary.
 * Users must explicitly opt in via --channels for all channel servers.
 *
 *   skip      Not a channel server, or not allowlisted/registered.
 *             Connection stays up; handler not registered.
 *   register  Subscribe to notifications/claude/channel.
 *
 * Which servers can connect at all is governed by allowedMcpServers —
 * this gate only decides whether the notification handler registers.
 */
export function gateChannelServer(
  serverName: string,
  capabilities: ServerCapabilities | undefined,
  pluginSource: string | undefined,
): ChannelGateResult {
  // Channel servers declare `experimental['claude/channel']: {}` (MCP's
  // presence-signal idiom — same as `tools: {}`). Truthy covers `{}` and
  // `true`; absent/undefined/explicit-`false` all fail. Key matches the
  // notification method namespace (notifications/claude/channel).
  if (!capabilities?.experimental?.['claude/channel']) {
    return {
      action: 'skip',
      kind: 'capability',
      reason: 'server did not declare claude/channel capability',
    }
  }

  // Overall runtime gate. After capability so normal MCP servers never hit
  // this path. Before auth/policy so the killswitch works regardless of
  // session state.
  // OpenClaude: isChannelsEnabled() now always returns true (no GrowthBook).
  if (!isChannelsEnabled()) {
    return {
      action: 'skip',
      kind: 'disabled',
      reason: 'channels feature is not currently available',
    }
  }

  // OpenClaude: OAuth and org policy gates removed.
  // Original Claude Code requires claude.ai OAuth and Teams/Enterprise
  // channelsEnabled policy. OpenClaude users control their own setup
  // (API key or OAuth) and have no managed org admin console, so these
  // gates are bypassed. The session allowlist (--channels flag) and
  // capability check remain as the security boundary.

  // User-level session opt-in. A server must be explicitly listed in
  // --channels to push inbound this session — protects against a trusted
  // server surprise-adding the capability. No auto-registration: even
  // allowlisted plugins require explicit --channels opt-in.
  const entry = findChannelEntry(serverName, getAllowedChannels())
  if (!entry) {
    return {
      action: 'skip',
      kind: 'session',
      reason: `server ${serverName} not in --channels list for this session (use --channels plugin:<name>@<marketplace> or install an approved channel plugin)`,
    }
  }

  if (entry.kind === 'plugin') {
    // Marketplace verification: the tag is intent (plugin:slack@anthropic),
    // the runtime name is just plugin:slack:X — could be slack@anthropic or
    // slack@evil depending on what's installed. Verify they match before
    // trusting the tag for the allowlist check below. Source is stashed on
    // the config at addPluginScopeToServers — undefined (non-plugin server,
    // shouldn't happen for plugin-kind entry) or @-less (builtin/inline)
    // both fail the comparison.
    const actual = pluginSource
      ? parsePluginIdentifier(pluginSource).marketplace
      : undefined
    if (actual !== entry.marketplace) {
      return {
        action: 'skip',
        kind: 'marketplace',
        reason: `you asked for plugin:${entry.name}@${entry.marketplace} but the installed ${entry.name} plugin is from ${actual ?? 'an unknown source'}`,
      }
    }

    // Approved-plugin allowlist. Marketplace gate already verified
    // tag == reality, so this is a pure entry check. entry.dev (per-entry,
    // not the session-wide bit) bypasses — so accepting the dev dialog for
    // one entry doesn't leak allowlist-bypass to --channels entries.
    if (!entry.dev) {
      // OpenClaude: use hardcoded allowlist from getChannelAllowlist()
      // instead of GrowthBook + org policy. No sub/policy variables needed.
      const entries = getChannelAllowlist()
      if (
        !entries.some(
          e => e.plugin === entry.name && e.marketplace === entry.marketplace,
        )
      ) {
        return {
          action: 'skip',
          kind: 'allowlist',
          reason: `plugin ${entry.name}@${entry.marketplace} is not on the approved channels allowlist (use --dangerously-load-development-channels for local dev)`,
        }
      }
    }
  } else {
    // server-kind entries are never covered by the plugin allowlist, so keep
    // the original safety boundary: manually configured MCP servers must be
    // marked as development entries before they can register for inbound
    // channel notifications.
    if (!entry.dev) {
      return {
        action: 'skip',
        kind: 'allowlist',
        reason:
          'server entries require --dangerously-load-development-channels before they can register as channels',
      }
    }
  }

  return { action: 'register' }
}
