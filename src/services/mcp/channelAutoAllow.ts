/**
 * Computes the auto-allow rules for a channel server. Extracted from the
 * inline logic in useManageMCPConnections/print.ts so the trust boundary
 * can be tested independently.
 *
 * Trust model: only official (non-dev) plugin entries get auto-allow, and
 * only for the reply tool (responding to inbound traffic). The broader
 * send tool (proactive outbound) goes through the normal permission
 * prompt. Server-kind, dev, and unrecognised entries get nothing.
 */
import type { ChannelEntry } from '../../bootstrap/state.js'
import { getMcpPrefix } from './mcpStringUtils.js'

/**
 * Returns the tool permission rules that should be auto-allowed for a
 * channel server, or an empty array if none should be granted.
 *
 * @param serverName  MCP server name (e.g. "plugin:telegram:abc")
 * @param entry       The channel entry from the session list, or undefined
 * @returns           Tool rules like ["mcp__plugin_telegram_abc__reply", ...]
 */
export function computeChannelAutoAllowRules(
  serverName: string,
  entry: ChannelEntry | undefined,
): string[] {
  if (entry?.kind !== 'plugin' || entry?.dev === true) {
    return []
  }
  const toolPrefix = getMcpPrefix(serverName)
  return [`${toolPrefix}reply`]
}

/**
 * Merges new auto-allow rules into an existing session rules array,
 * deduplicating. Returns null if no new rules need to be added.
 */
export function mergeAutoAllowRules(
  existingRules: string[],
  newRules: string[],
): string[] | null {
  const toAdd = newRules.filter(rule => !existingRules.includes(rule))
  if (toAdd.length === 0) return null
  return [...existingRules, ...toAdd]
}
