/**
 * Approved channel plugins allowlist. --channels plugin:name@marketplace
 * entries only register if {marketplace, plugin} is on this list. server:
 * entries can be specified directly in OpenClaude, but only dev-flagged
 * server entries register via --dangerously-load-development-channels. The
 * flag bypasses the allowlist for both kinds.
 *
 * OpenClaude: hardcoded allowlist replaces GrowthBook-sourced list.
 * Custom channels work via --dangerously-load-development-channels.
 */

import { parsePluginIdentifier } from '../../utils/plugins/pluginIdentifier.js'

export type ChannelAllowlistEntry = {
  marketplace: string
  plugin: string
}

export function getChannelAllowlist(): ChannelAllowlistEntry[] {
  // OpenClaude: hardcode official channel plugins so they work without
  // GrowthBook. Custom channels still work via --dangerously-load-development-channels.
  return [
    { marketplace: 'claude-plugins-official', plugin: 'telegram' },
    { marketplace: 'claude-plugins-official', plugin: 'discord' },
    { marketplace: 'claude-plugins-official', plugin: 'imessage' },
    { marketplace: 'claude-plugins-official', plugin: 'fakechat' },
  ]
}

/**
 * Overall channels on/off. Checked before any per-server gating —
 * when false, --channels is a no-op and no handlers register.
 * Default false; GrowthBook 5-min refresh.
 */
export function isChannelsEnabled(): boolean {
  // OpenClaude: bypass GrowthBook gate — channels always available
  return true
}

/**
 * Pure allowlist check keyed off the connection's pluginSource — for UI
 * pre-filtering so the IDE only shows "Enable channel?" for servers that will
 * actually pass the gate. Not a security boundary: channel_enable still runs
 * the full gate. Matches the allowlist comparison inside gateChannelServer()
 * but standalone (no session/marketplace coupling — those are tautologies
 * when the entry is derived from pluginSource).
 *
 * Returns false for undefined pluginSource (non-plugin server — can never
 * match the {marketplace, plugin}-keyed ledger) and for @-less sources
 * (builtin/inline — same reason).
 */
export function isChannelAllowlisted(
  pluginSource: string | undefined,
): boolean {
  if (!pluginSource) return false
  const { name, marketplace } = parsePluginIdentifier(pluginSource)
  if (!marketplace) return false
  return getChannelAllowlist().some(
    e => e.plugin === name && e.marketplace === marketplace,
  )
}
