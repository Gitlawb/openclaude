import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { logEvent } from '../services/analytics/index.js'
import type {
  ConnectedMCPServer,
  MCPServerConnection,
} from '../services/mcp/types.js'
import type { Message } from '../types/message.js'
import { isEnvDefinedFalsy, isEnvTruthy } from './envUtils.js'

export type McpInstructionsDelta = {
  /** Server names — for stateless-scan reconstruction. */
  addedNames: string[]
  /** Rendered "## {name}\n{instructions}" blocks for addedNames. */
  addedBlocks: string[]
  removedNames: string[]
}

/**
 * Client-authored instruction block to announce when a server connects,
 * in addition to (or instead of) the server's own `InitializeResult.instructions`.
 * Lets first-party servers (e.g., claude-in-chrome) carry client-side
 * context the server itself doesn't know about.
 */
export type ClientSideInstruction = {
  serverName: string
  block: string
}

/**
 * True → announce MCP server instructions via persisted delta attachments.
 * False → prompts.ts keeps its DANGEROUS_uncachedSystemPromptSection
 * (rebuilt every turn; cache-busts on late connect).
 *
 * Env override for local testing: CLAUDE_CODE_MCP_INSTR_DELTA=true/false
 * wins over both ant bypass and the GrowthBook gate.
 */
export function isMcpInstructionsDeltaEnabled(): boolean {
  if (isEnvTruthy(process.env.CLAUDE_CODE_MCP_INSTR_DELTA)) return true
  if (isEnvDefinedFalsy(process.env.CLAUDE_CODE_MCP_INSTR_DELTA)) return false
  return (
    process.env.USER_TYPE === 'ant' ||
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_basalt_3kr', true)
  )
}

/**
 * Reconstruct name → rendered instruction block from prior deltas.
 * Removals apply first so a same-name update (removed + re-added in one
 * delta) ends with the new block in the map.
 */
export function getAnnouncedMcpInstructionBlocks(
  messages: Message[],
): Map<string, string> {
  const announced = new Map<string, string>()
  for (const msg of messages) {
    if (msg.type !== 'attachment') continue
    // Legacy transcripts may carry malformed attachment records
    // (null/undefined/non-object payload). Skip instead of throwing.
    if (!msg.attachment || typeof msg.attachment !== 'object') continue
    if (Array.isArray(msg.attachment)) continue
    if (msg.attachment.type !== 'mcp_instructions_delta') continue
    // Require the full recognized schema before processing. Malformed or
    // partial legacy entries must be skipped — not partially applied.
    const { addedNames, addedBlocks, removedNames } = msg.attachment
    if (
      !Array.isArray(removedNames) ||
      !Array.isArray(addedNames) ||
      !Array.isArray(addedBlocks)
    ) {
      continue
    }
    for (const n of removedNames) {
      if (typeof n === 'string') announced.delete(n)
    }
    for (let i = 0; i < addedNames.length; i++) {
      const name = addedNames[i]
      const block = addedBlocks[i]
      if (typeof name === 'string' && typeof block === 'string') {
        announced.set(name, block)
      }
    }
  }
  return announced
}

/**
 * Diff the current set of connected MCP servers that have instructions
 * (server-authored via InitializeResult, or client-side synthesized)
 * against what's already been announced in this conversation. Null if
 * nothing changed.
 *
 * Within a single process, InitializeResult.instructions are immutable for
 * the life of a connection. Across --resume, a fresh MCP handshake can
 * return different instructions under the same configured server name
 * (deploy / config / auth-policy). Diff on the rendered block, not name
 * alone, so stale instructions are re-announced.
 */
export function getMcpInstructionsDelta(
  mcpClients: MCPServerConnection[],
  messages: Message[],
  clientSideInstructions: ClientSideInstruction[],
): McpInstructionsDelta | null {
  let attachmentCount = 0
  let midCount = 0
  for (const msg of messages) {
    if (msg.type !== 'attachment') continue
    if (!msg.attachment || typeof msg.attachment !== 'object') continue
    if (Array.isArray(msg.attachment)) continue
    attachmentCount++
    if (
      msg.attachment.type === 'mcp_instructions_delta' &&
      Array.isArray(msg.attachment.removedNames) &&
      Array.isArray(msg.attachment.addedNames) &&
      Array.isArray(msg.attachment.addedBlocks)
    ) {
      midCount++
    }
  }

  const announced = getAnnouncedMcpInstructionBlocks(messages)

  const connected = mcpClients.filter(
    (c): c is ConnectedMCPServer => c.type === 'connected',
  )
  const connectedNames = new Set(connected.map(c => c.name))

  // Servers with instructions to announce (either channel). A server can
  // have both: server-authored instructions + a client-side block appended.
  const blocks = new Map<string, string>()
  for (const c of connected) {
    if (c.instructions) blocks.set(c.name, `## ${c.name}\n${c.instructions}`)
  }
  for (const ci of clientSideInstructions) {
    if (!connectedNames.has(ci.serverName)) continue
    const existing = blocks.get(ci.serverName)
    blocks.set(
      ci.serverName,
      existing
        ? `${existing}\n\n${ci.block}`
        : `## ${ci.serverName}\n${ci.block}`,
    )
  }

  const added: Array<{ name: string; block: string }> = []
  for (const [name, block] of blocks) {
    const prev = announced.get(name)
    // New server, or same name with a different rendered block (resume /
    // reconnect with updated InitializeResult.instructions).
    if (prev === undefined || prev !== block) {
      added.push({ name, block })
    }
  }

  // Previously-announced server that is no longer connected, or still
  // connected but has no block to announce (empty instructions + no
  // client-side block) → removed. Content-changed servers stay connected;
  // they are re-added above with the new block (history keeps the old
  // attachment; the new delta is the corrective update the model should follow).
  //
  // Resume race: interactive --resume / --continue does not block on MCP
  // connect, so the first attachment pass often sees mcpClients=[] while
  // announced is non-empty (local JSONL now persists mcp_instructions_delta).
  // Empty / all-pending clients means "not connected yet", not "disconnected"
  // — hold name-based removals until at least one client leaves pending.
  //
  // Mixed state: an unrelated connected client must NOT authorize removal of
  // a server that is still pending (other connected + docs pending → keep
  // docs until docs settles or disappears from the client list).
  const clientSetSettledForRemovals =
    mcpClients.length > 0 &&
    mcpClients.some(c => c.type !== 'pending')
  const removed: string[] = []
  for (const n of announced.keys()) {
    if (connectedNames.has(n)) {
      if (!blocks.has(n)) removed.push(n)
      continue
    }
    const serverStillPending = mcpClients.some(
      c => c.type === 'pending' && c.name === n,
    )
    if (serverStillPending) continue
    if (!clientSetSettledForRemovals) continue
    removed.push(n)
  }

  if (added.length === 0 && removed.length === 0) return null

  // Same diagnostic fields as tengu_deferred_tools_pool_change — same
  // scan-fails-in-prod bug, same attachment persistence path.
  logEvent('tengu_mcp_instructions_pool_change', {
    addedCount: added.length,
    removedCount: removed.length,
    priorAnnouncedCount: announced.size,
    clientSideCount: clientSideInstructions.length,
    messagesLength: messages.length,
    attachmentCount,
    midCount,
  })

  added.sort((a, b) => a.name.localeCompare(b.name))
  return {
    addedNames: added.map(a => a.name),
    addedBlocks: added.map(a => a.block),
    removedNames: removed.sort(),
  }
}
