/**
 * Query API for the SDK.
 *
 * Provides the Query interface, QueryImpl class, and the query()/queryAsync()
 * factory functions.
 */

import { randomUUID } from 'crypto'
import { dirname } from 'path'
import { QueryEngine } from '../../QueryEngine.js'
import {
  getDefaultAppState,
  type AppState,
} from '../../state/AppStateStore.js'
import { createStore, type Store } from '../../state/store.js'
import {
  getEmptyToolPermissionContext,
  type ToolPermissionContext,
} from '../../Tool.js'
import { getTools } from '../../tools.js'
import { createFileStateCacheWithSizeLimit } from '../../utils/fileStateCache.js'
import { init } from '../init.js'
import {
  resolveSessionFilePath,
  readTranscriptForLoad,
  SKIP_PRECOMPACT_THRESHOLD,
} from '../../utils/sessionStoragePortable.js'
import { readJSONLFile } from '../../utils/json.js'
import { stat } from 'fs/promises'
import {
  switchSession,
  regenerateSessionId,
  getSessionId,
  runWithSdkContext,
} from '../../bootstrap/state.js'
import type { SessionId } from '../../types/ids.js'
import { getAgentDefinitionsWithOverrides } from '../../tools/AgentTool/loadAgentsDir.js'
import type {
  RewindFilesResult,
  McpServerStatus,
  ApiKeySource,
  PermissionResult,
} from './sdk/coreTypes.generated.js'
import {
  fileHistoryCanRestore,
  fileHistoryGetDiffStats,
  fileHistoryRewind,
} from '../../utils/fileHistory.js'
import type { MCPServerConnection } from '../../services/mcp/types.js'
import {
  acquireEnvMutex,
  releaseEnvMutex,
  mapMessageToSDK,
  type SDKMessage,
  type SDKUserMessage,
  type SDKPermissionTimeoutMessage,
  type SDKAgentLoadFailureMessage,
  type JsonlEntry,
  type QueryPermissionMode,
  type CanUseToolCallback,
  type SDKSessionInfo,
} from './shared.js'
import {
  buildPermissionContext,
  createExternalCanUseTool,
  connectSdkMcpServers,
  createDefaultCanUseTool,
  createOnceOnlyResolve,
  type PermissionResolveDecision,
} from './permissions.js'
import {
  listSessions,
  forkSession,
} from './sessions.js'

// ============================================================================
// QueryOptions type
// ============================================================================

/** Options for the query() function. */
export type QueryOptions = {
  /** Working directory for the query. Required. */
  cwd: string
  /** Additional directories the agent can access. */
  additionalDirectories?: string[]
  /** Model to use (e.g. 'claude-sonnet-4-6'). */
  model?: string
  /** Resume an existing session by ID. */
  sessionId?: string
  /** Fork the session before resuming (requires sessionId). */
  fork?: boolean
  /** Alias for fork. When true, resumed session forks to a new session ID. */
  forkSession?: boolean
  /** Resume the most recent session for this cwd (no sessionId needed). */
  continue?: boolean
  /** Resume strategy. */
  resume?: string
  /** When resuming, resume messages up to and including this message UUID. */
  resumeSessionAt?: string
  /** Permission mode for tool access. */
  permissionMode?: QueryPermissionMode
  /** AbortController to cancel the query. */
  abortController?: AbortController
  /** Executable name for subprocess spawning. */
  executable?: string
  /** Skip permission prompts entirely (dangerous). */
  allowDangerouslySkipPermissions?: boolean
  /** Tools to disallow. */
  disallowedTools?: string[]
  /** Hook configuration. */
  hooks?: Record<string, unknown[]>
  /** MCP server configuration. */
  mcpServers?: Record<string, unknown>
  /** Settings overrides. */
  settings?: {
    env?: Record<string, string>
    attribution?: { commit: string; pr: string }
  }
  /** Environment variables to apply during query execution. Takes precedence over settings.env. */
  env?: Record<string, string | undefined>
  /**
   * Callback invoked before each tool use. Return `{ behavior: 'allow' }` to
   * permit the call or `{ behavior: 'deny', message?: string }` to reject it.
   *
   * **Secure-by-default**: If neither `canUseTool` nor `onPermissionRequest`
   * is provided, ALL tool uses are denied. You MUST provide at least one of
   * these callbacks to allow tool execution.
   */
  canUseTool?: CanUseToolCallback
  /**
   * Callback invoked when a tool needs permission approval. The host receives
   * the request immediately and can resolve it by calling
   * `query.respondToPermission(toolUseId, decision)` before the 30s timeout.
   * If omitted, tools that require permission fall through to the default
   * permission logic immediately (no timeout).
   */
  onPermissionRequest?: (message: import('./shared.js').SDKPermissionRequestMessage) => void
  /** System prompt override. */
  systemPrompt?:
    | string
    | { type: 'preset'; preset: string; append?: string }
    | { type: 'custom'; content: string }
  /** Agent definitions to register with the query engine. */
  agents?: Record<string, {
    description: string
    prompt: string
    tools?: string[]
    disallowedTools?: string[]
    model?: string
    maxTurns?: number
  }>
  /** Setting sources to load. */
  settingSources?: string[]
  /** When true, yields stream_event messages for token-by-token streaming. */
  includePartialMessages?: boolean
  /** @internal Timeout in ms for permission request resolution. Default 30000. */
  _permissionTimeoutMs?: number
  /** Callback for stderr output. */
  stderr?: (data: string) => void
}

/**
 * A Query object represents an active conversation with the agent.
 * It implements AsyncIterable<SDKMessage> so you can use `for await` loops.
 */
export interface Query {
  /** The session ID for this query. Available immediately after query() returns. */
  readonly sessionId: string
  /** Iterate over SDK messages produced by the query. */
  [Symbol.asyncIterator](): AsyncIterator<SDKMessage>
  /** Change the model mid-conversation. */
  setModel(model: string): Promise<void>
  /** Change the permission mode mid-conversation. */
  setPermissionMode(mode: QueryPermissionMode): Promise<void>
  /** Cleanup resources and stop iteration. */
  close(): void
  /** Abort the current operation. */
  interrupt(): void
  /** Respond to a pending permission prompt. */
  respondToPermission(toolUseId: string, decision: PermissionResult): void
  /** Undo file changes made during the session. */
  rewindFiles(): RewindFilesResult
  /** Actually perform the file rewind. Returns files changed and diff stats. */
  rewindFilesAsync(): Promise<RewindFilesResult>
  /** List available slash commands. */
  supportedCommands(): string[]
  /** List available models. */
  supportedModels(): string[]
  /** List available subagent types. */
  supportedAgents(): string[]
  /** Get MCP server connection status. */
  mcpServerStatus(): McpServerStatus[]
  /** Get account/authentication info. */
  accountInfo(): Promise<{ apiKeySource: ApiKeySource; [key: string]: unknown }>
  /** Set the thinking token budget. */
  setMaxThinkingTokens(tokens: number): void
}

// ============================================================================
// loadAndInjectSessionMessages
// ============================================================================

/**
 * Parse JSONL lines into typed entries, skipping malformed lines.
 */
function parseJsonlLines(text: string): JsonlEntry[] {
  const entries: JsonlEntry[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      entries.push(JSON.parse(trimmed))
    } catch {
      // Skip malformed lines
    }
  }
  return entries
}

/**
 * Find the index of the last compact_boundary entry and check for preserved segment.
 * Returns { index, preservedSegment } where preservedSegment contains headUuid, tailUuid,
 * anchorUuid if present, or null if no preserved segment.
 * Returns { index: -1, preservedSegment: null } if no compact boundary exists.
 */
function findLastCompactBoundary(entries: JsonlEntry[]): {
  index: number
  preservedSegment: { headUuid: string; tailUuid: string; anchorUuid: string } | null
} {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]
    if (e.type === 'system' && (e as Record<string, unknown>).subtype === 'compact_boundary') {
      const meta = (e as Record<string, unknown>).compactMetadata as {
        preservedSegment?: { headUuid?: string; tailUuid?: string; anchorUuid?: string }
      } | undefined
      const seg = meta?.preservedSegment
      if (seg?.headUuid && seg?.tailUuid && seg?.anchorUuid) {
        return {
          index: i,
          preservedSegment: { headUuid: seg.headUuid, tailUuid: seg.tailUuid, anchorUuid: seg.anchorUuid },
        }
      }
      return { index: i, preservedSegment: null }
    }
  }
  return { index: -1, preservedSegment: null }
}

/**
 * Apply preserved segment relinks matching CLI's applyPreservedSegmentRelinks().
 * - Walk tailUuid → headUuid to collect preserved UUIDs
 * - Set head.parentUuid = anchorUuid (relink preserved chain to anchor)
 * - Splice anchor's other children to tailUuid (anchor'a bağlı olup head olmayanlar tailUuid'a bağlanır)
 * - Returns set of preserved UUIDs to keep, or empty set if relink failed
 */
function applyPreservedSegmentRelinks(
  byUuid: Map<string, JsonlEntry & { parentUuid?: string | null }>,
  seg: { headUuid: string; tailUuid: string; anchorUuid: string },
): Set<string> {
  const preservedUuids = new Set<string>()

  // Validate tail → head walk
  const tailInTranscript = byUuid.has(seg.tailUuid)
  const headInTranscript = byUuid.has(seg.headUuid)
  const anchorInTranscript = byUuid.has(seg.anchorUuid)

  if (!tailInTranscript || !headInTranscript || !anchorInTranscript) {
    return preservedUuids // Fail closed — empty set means prune everything
  }

  // Walk tail → head
  const walkSeen = new Set<string>()
  let cur = byUuid.get(seg.tailUuid)
  let reachedHead = false

  while (cur) {
    if (walkSeen.has(cur.uuid!)) break // Cycle
    walkSeen.add(cur.uuid!)
    preservedUuids.add(cur.uuid!)
    if (cur.uuid === seg.headUuid) {
      reachedHead = true
      break
    }
    if (!cur.parentUuid) break // Null parent before head
    cur = byUuid.get(cur.parentUuid)
  }

  if (!reachedHead) {
    return new Set<string>() // Walk failed — fail closed
  }

  // Relink: head.parentUuid = anchorUuid
  const head = byUuid.get(seg.headUuid)
  if (head) {
    byUuid.set(seg.headUuid, { ...head, parentUuid: seg.anchorUuid })
  }

  // Splice: anchor'a bağlı olup head olmayanları tailUuid'a bağla
  for (const [uuid, entry] of byUuid) {
    if (entry.parentUuid === seg.anchorUuid && uuid !== seg.headUuid) {
      byUuid.set(uuid, { ...entry, parentUuid: seg.tailUuid })
    }
  }

  return preservedUuids
}

/**
 * Build a linear conversation chain by walking parentUuid links from a leaf
 * message backwards, then reversing. Matches CLI's buildConversationChain().
 */
function buildConversationChain(
  byUuid: Map<string, JsonlEntry & { parentUuid?: string | null }>,
  leaf: JsonlEntry & { parentUuid?: string | null },
): (JsonlEntry & { parentUuid?: string | null })[] {
  const chain: (JsonlEntry & { parentUuid?: string | null })[] = []
  const seen = new Set<string>()
  let current: (JsonlEntry & { parentUuid?: string | null }) | undefined = leaf
  while (current) {
    if (!current.uuid || seen.has(current.uuid)) break
    seen.add(current.uuid)
    chain.push(current)
    current = current.parentUuid ? byUuid.get(current.parentUuid) : undefined
  }
  chain.reverse()
  return chain
}

/**
 * Strip transcript-internal fields and system entries that engine doesn't expect.
 * Matches CLI's removeExtraFields() but also filters out system entries
 * (compact_boundary, etc.) that should not be passed to the engine.
 */
function stripExtraFields(
  messages: (JsonlEntry & { parentUuid?: string | null })[],
): unknown[] {
  return messages
    .filter(m => m.type !== 'system') // Filter out system entries
    .map(m => {
      const { isSidechain, parentUuid, logicalParentUuid, ...rest } = m as Record<string, unknown> & { isSidechain?: boolean; parentUuid?: string | null; logicalParentUuid?: string | null }
      return rest
    })
}

/**
 * Load a session's conversation messages from its JSONL file and inject
 * them into the QueryEngine so the conversation resumes from that history.
 *
 * Uses compact-aware loading that matches the CLI resume path:
 *  - Large files: readTranscriptForLoad() with preserved segment awareness
 *  - Small files: detect compact boundaries, apply preserved segment relinks
 *  - Build parentUuid chain from latest leaf (matching buildConversationChain)
 *  - Support upToUuid for rollback/resumeSessionAt
 *
 * Preserved segment handling (matching CLI's applyPreservedSegmentRelinks):
 *  - Walk tailUuid → headUuid to collect preserved UUIDs
 *  - Relink head.parentUuid = anchorUuid
 *  - Splice anchor's other children to tailUuid
 *  - Keep only preserved UUIDs + post-boundary entries
 *
 * Returns { loaded, transcriptDir } where transcriptDir is the directory
 * containing the JSONL file (for sessionProjectDir routing).
 */
async function loadAndInjectSessionMessages(
  sessionId: string,
  cwd: string,
  engine: QueryEngine,
  upToUuid?: string,
): Promise<{ loaded: boolean; transcriptDir: string | null }> {
  const resolved = await resolveSessionFilePath(sessionId, cwd)
  if (!resolved) return { loaded: false, transcriptDir: null }

  const transcriptDir = dirname(resolved.filePath)

  // Step 1: Read entries — compact-aware for large files
  let entries: JsonlEntry[]
  let preservedSegment: { headUuid: string; tailUuid: string; anchorUuid: string } | null = null
  let boundaryIndex = -1

  const { size: fileSize } = await stat(resolved.filePath)
  if (fileSize > SKIP_PRECOMPACT_THRESHOLD) {
    const scan = await readTranscriptForLoad(resolved.filePath, fileSize)
    entries = parseJsonlLines(scan.postBoundaryBuf.toString('utf8'))
    // For large files, scan.hasPreservedSegment indicates preserved content exists
    // but we need to find the actual segment metadata in the post-boundary entries
    const boundary = findLastCompactBoundary(entries)
    preservedSegment = boundary.preservedSegment
    boundaryIndex = boundary.index
  } else {
    entries = await readJSONLFile<JsonlEntry>(resolved.filePath)
    const boundary = findLastCompactBoundary(entries)
    preservedSegment = boundary.preservedSegment
    boundaryIndex = boundary.index
  }

  // Step 2: Index ALL non-sidechain entries by UUID (user, assistant, system, etc.)
  // This matches CLI's loadTranscriptFile() which indexes the full transcript chain.
  // The preserved segment relink needs access to system compact_boundary entries
  // when anchorUuid === boundary.uuid.
  type ChainEntry = JsonlEntry & { parentUuid?: string | null }
  const byUuid = new Map<string, ChainEntry>()
  for (const entry of entries) {
    if (entry.isSidechain) continue
    // Include user, assistant, AND system (compact_boundary) entries
    // Exclude only pure metadata entries without conversational role
    if (entry.uuid) {
      byUuid.set(entry.uuid, entry as ChainEntry)
    }
  }

  // Step 3: Apply preserved segment relinks if segment exists
  let preservedUuids = new Set<string>()
  if (preservedSegment) {
    preservedUuids = applyPreservedSegmentRelinks(byUuid, preservedSegment)
  }

  // Step 4: Prune pre-boundary entries (keep only preserved + post-boundary)
  if (boundaryIndex >= 0 && !preservedSegment) {
    // No preserved segment — simple slice
    const postBoundaryUuids = new Set<string>()
    for (const entry of entries.slice(boundaryIndex + 1)) {
      if (entry.uuid && !entry.isSidechain) postBoundaryUuids.add(entry.uuid)
    }
    // Remove entries not in post-boundary
    for (const uuid of byUuid.keys()) {
      if (!postBoundaryUuids.has(uuid)) byUuid.delete(uuid)
    }
  } else if (boundaryIndex >= 0 && preservedSegment && preservedUuids.size > 0) {
    // Preserved segment exists and relink succeeded — keep preserved + anchor + post-boundary
    const postBoundaryUuids = new Set<string>()
    for (const entry of entries.slice(boundaryIndex + 1)) {
      if (entry.uuid && !entry.isSidechain) postBoundaryUuids.add(entry.uuid)
    }
    // Keep: preserved entries + anchor + post-boundary entries
    // The anchor is needed because preserved head.parentUuid = anchor after relink
    const anchorUuid = preservedSegment.anchorUuid
    for (const uuid of byUuid.keys()) {
      if (!preservedUuids.has(uuid) && !postBoundaryUuids.has(uuid) && uuid !== anchorUuid) {
        byUuid.delete(uuid)
      }
    }
  } else if (boundaryIndex >= 0 && preservedSegment && preservedUuids.size === 0) {
    // Preserved segment exists but relink failed — fail closed, keep only post-boundary
    const postBoundaryUuids = new Set<string>()
    for (const entry of entries.slice(boundaryIndex + 1)) {
      if (entry.uuid && !entry.isSidechain) postBoundaryUuids.add(entry.uuid)
    }
    for (const uuid of byUuid.keys()) {
      if (!postBoundaryUuids.has(uuid)) byUuid.delete(uuid)
    }
  }

  if (byUuid.size === 0) {
    return { loaded: true, transcriptDir }
  }

  // Step 5: Select leaf — either upToUuid target, or latest USER/ASSISTANT entry
  // Note: Leaf selection uses only user/assistant, but chain building uses full map
  // (including system compact_boundary) so parent chain is complete.
  let leaf: ChainEntry | undefined
  if (upToUuid) {
    leaf = byUuid.get(upToUuid)
    if (!leaf) {
      throw new Error(`resumeSessionAt ${upToUuid} not found in session ${sessionId}`)
    }
  } else {
    // Find latest user/assistant leaf: highest timestamp among user/assistant entries
    // that are not a parent of another entry
    const parentUuids = new Set<string>()
    for (const e of byUuid.values()) {
      if (e.parentUuid) parentUuids.add(e.parentUuid)
    }
    let bestTs = -1
    for (const e of byUuid.values()) {
      // Only consider user/assistant for leaf (not system compact_boundary)
      if (e.type !== 'user' && e.type !== 'assistant') continue
      // A leaf is an entry that no other entry references as parent
      if (parentUuids.has(e.uuid!)) continue
      const ts = e.timestamp ? new Date(e.timestamp as string).getTime() : 0
      if (ts >= bestTs) {
        bestTs = ts
        leaf = e
      }
    }
  }

  if (!leaf) {
    return { loaded: true, transcriptDir }
  }

  // Step 5: Build conversation chain and strip internal fields
  const chain = buildConversationChain(byUuid, leaf)
  const messages = stripExtraFields(chain)

  if (messages.length > 0) {
    engine.injectMessages(messages as Parameters<QueryEngine['injectMessages']>[0])
  }
  return { loaded: true, transcriptDir }
}

// ============================================================================
// QueryImpl — the concrete Query class
// ============================================================================

class QueryImpl implements Query {
  private _engine: QueryEngine | null = null
  /** Track whether engine was injected at construction (test/mock) vs created fresh. */
  private _engineWasInjected: boolean
  private get engine(): QueryEngine {
    if (!this._engine) {
      throw new Error('QueryImpl: engine not initialized. Call setEngine() first.')
    }
    return this._engine
  }
  private prompt: string | AsyncIterable<SDKUserMessage>
  private abortController: AbortController
  private appStateStore: Store<AppState>
  private pendingPermissionPrompts = new Map<string, {
    resolve: (decision: PermissionResolveDecision) => void
  }>()
  private envOverrides: Record<string, string | undefined> | undefined
  private envSnapshot: Record<string, string | undefined> | undefined
  private _sessionId: string
  private _sessionIdExplicitlyProvided: boolean
  private shouldFork?: boolean
  private continueSession?: boolean
  private cwd: string
  private resumeSessionAt?: string
  private userAgents?: QueryOptions['agents']
  private mcpServers?: Record<string, unknown>
  private permissionContext: ToolPermissionContext
  private timeoutQueue: SDKPermissionTimeoutMessage[] = []
  private agentFailureQueue: SDKAgentLoadFailureMessage[] = []

  constructor(
    engine: QueryEngine | null,
    prompt: string | AsyncIterable<SDKUserMessage>,
    abortController: AbortController,
    appStateStore: Store<AppState>,
    envOverrides: Record<string, string | undefined> | undefined,
    sessionId?: string,
    fork?: boolean,
    continueSession?: boolean,
    cwd: string = '',
    resumeSessionAt?: string,
    userAgents?: QueryOptions['agents'],
    mcpServers?: Record<string, unknown>,
    permissionContext: ToolPermissionContext = getEmptyToolPermissionContext(),
  ) {
    this._engineWasInjected = engine !== null
    if (engine) this._engine = engine
    this.prompt = prompt
    this.abortController = abortController
    this.appStateStore = appStateStore
    this.envOverrides = envOverrides
    this._sessionIdExplicitlyProvided = sessionId !== undefined
    this._sessionId = sessionId ?? randomUUID()
    this.shouldFork = fork
    this.continueSession = continueSession
    this.cwd = cwd
    this.resumeSessionAt = resumeSessionAt
    this.userAgents = userAgents
    this.mcpServers = mcpServers
    this.permissionContext = permissionContext
  }

  /** The session ID for this query. Available immediately after query() returns. */
  get sessionId(): string {
    return this._sessionId
  }

  /** Late-bind the engine (used by query() which creates QueryImpl before the engine). */
  setEngine(engine: QueryEngine): void {
    this._engine = engine
  }

  /**
   * Register a pending permission prompt for external resolution.
   * Returns a Promise that resolves when respondToPermission() is called
   * with the matching toolUseId.
   */
  registerPendingPermission(toolUseId: string): Promise<PermissionResolveDecision> {
    return new Promise(resolve => {
      const wrappedResolve = createOnceOnlyResolve(resolve)
      this.pendingPermissionPrompts.set(toolUseId, { resolve: wrappedResolve })
    })
  }

  /** Push a timeout message into the queue for later draining. */
  pushTimeout(msg: SDKPermissionTimeoutMessage): void {
    this.timeoutQueue.push(msg)
  }

  /** Drain all queued timeout messages. */
  private *drainTimeoutQueue(): Generator<SDKPermissionTimeoutMessage> {
    while (this.timeoutQueue.length > 0) {
      yield this.timeoutQueue.shift()!
    }
  }

  /** Push an agent load failure message into the queue for later draining. */
  pushAgentFailure(msg: SDKAgentLoadFailureMessage): void {
    this.agentFailureQueue.push(msg)
  }

  /** Drain all queued agent failure messages. */
  private *drainAgentFailureQueue(): Generator<SDKAgentLoadFailureMessage> {
    while (this.agentFailureQueue.length > 0) {
      yield this.agentFailureQueue.shift()!
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    const hasEnvOverrides = this.envOverrides && Object.keys(this.envOverrides).length > 0

    const sdkContext = {
      sessionId: this._sessionId as SessionId,
      sessionProjectDir: null as string | null, // Resolved below after session resolution
      cwd: this.cwd,
      originalCwd: this.cwd,
    }

    const self = this
    const inner = runWithSdkContext(sdkContext, () => {
      return (async function* (): AsyncIterator<SDKMessage> {
        // Fast exit: if interrupt()/close() was called before iteration
        // started, skip init entirely — avoids auth/network side-effects.
        if (self.abortController.signal.aborted) return

        // Track whether engine was injected at construction (test mock, SDK host override).
      // If so, init() failures are non-fatal — the mock engine is self-contained.
      // IMPORTANT: Check _engineWasInjected, not _engine !== null — the latter is
      // always true after setEngine() is called in the query() factory.
      const engineWasOverridden = self._engineWasInjected

        // Ensure init() completes before any query runs
        // init() applies config env vars, so we apply our overrides AFTER
        try {
          await init()
        } catch (initError) {
          // If a custom engine was injected (test mock, SDK host override),
          // init() failures are non-fatal — the engine handles everything.
          if (engineWasOverridden) {
            // Swallow — mock/overridden engine doesn't need real init
          } else {
            throw initError
          }
          }

          // Load agent definitions BEFORE creating engine context
          let agentDefs: { activeAgents: any[]; allAgents: any[] } = { activeAgents: [], allAgents: [] }
          try {
            agentDefs = await getAgentDefinitionsWithOverrides(self.cwd)
          } catch (err) {
            // Agent loading failed — continue without agents but emit failure event
            const errorMessage = err instanceof Error ? err.message : String(err)
            console.warn('SDK: agent definitions loading failed:', errorMessage)
            self.pushAgentFailure({
              type: 'agent_load_failure',
              stage: 'definitions',
              error_message: errorMessage,
            })
          }

          // Update AppState with agents
          self.appStateStore.setState(prev => ({
            ...prev,
            agentDefinitions: agentDefs,
          }))

          // Inject agents into the engine
          if (self.userAgents && Object.keys(self.userAgents).length > 0) {
            const userAgents: Array<{
              agentType: string
              whenToUse: string
              getSystemPrompt: () => string
              tools?: string[]
              disallowedTools?: string[]
              model?: string
              maxTurns?: number
            }> = Object.entries(self.userAgents).map(([name, def]) => ({
              agentType: name,
              whenToUse: def.description ?? name,
              getSystemPrompt: () => def.prompt ?? '',
              ...(def.tools ? { tools: def.tools } : {}),
              ...(def.disallowedTools ? { disallowedTools: def.disallowedTools } : {}),
              ...(def.model ? { model: def.model } : {}),
              ...(def.maxTurns ? { maxTurns: def.maxTurns } : {}),
            }))
            agentDefs.activeAgents.push(...userAgents)
          }
          if (agentDefs.activeAgents.length > 0) {
            try {
              self.engine.injectAgents(agentDefs.activeAgents)
            } catch (err) {
              // Agent injection failed — continue without agents but emit failure event
              const errorMessage = err instanceof Error ? err.message : String(err)
              console.warn('SDK: agent injection failed:', errorMessage)
              self.pushAgentFailure({
                type: 'agent_load_failure',
                stage: 'injection',
                error_message: errorMessage,
              })
            }
          }

          // Apply env overrides AFTER init() with full-duration mutex (SEC-1)
          if (hasEnvOverrides) {
            await acquireEnvMutex()
            self.envSnapshot = {}
            for (const key of Object.keys(self.envOverrides!)) {
              self.envSnapshot[key] = process.env[key]
            }
            for (const [key, value] of Object.entries(self.envOverrides!)) {
              if (value === undefined) {
                delete process.env[key]
              } else {
                process.env[key] = value
              }
            }
          }

          try {
            // Connect MCP servers if provided
            if (self.mcpServers && Object.keys(self.mcpServers).length > 0) {
              try {
                const { clients: mcpClients, tools: mcpTools } = await connectSdkMcpServers(self.mcpServers)
                if (mcpClients.length > 0) {
                  self.engine.config.mcpClients = mcpClients
                }
                if (mcpTools.length > 0) {
                  const allTools = getTools(self.permissionContext)
                  for (const mcpTool of mcpTools) {
                    if (!allTools.some(t => t.name === mcpTool.name)) {
                      allTools.push(mcpTool)
                    }
                  }
                  self.engine.updateTools(allTools)
                }
              } catch (err) {
                // MCP connection failed — continue without MCP tools
                console.warn('SDK: MCP server connection failed:', err instanceof Error ? err.message : String(err))
              }
            }

            // Handle continue/fork/resume session resolution
            let effectiveSessionId: string | undefined = self._sessionId
            let resolvedTranscriptDir: string | null = null

            if (self.continueSession && !self._sessionIdExplicitlyProvided) {
              const sessions = await listSessions({ dir: self.cwd, limit: 1 })
              if (sessions.length > 0) {
                effectiveSessionId = sessions[0].sessionId
                const result = await loadAndInjectSessionMessages(effectiveSessionId, self.cwd, self.engine, self.resumeSessionAt)
                if (result.loaded) {
                  resolvedTranscriptDir = result.transcriptDir
                } else {
                  effectiveSessionId = undefined
                }
              } else {
                // No existing sessions — keep the fresh UUID
                effectiveSessionId = undefined
              }
            } else if (self.shouldFork && self._sessionId) {
              try {
                const forkResult = await forkSession(self._sessionId, { dir: self.cwd })
                effectiveSessionId = forkResult.sessionId
                const result = await loadAndInjectSessionMessages(effectiveSessionId, self.cwd, self.engine, self.resumeSessionAt)
                if (result.loaded) {
                  resolvedTranscriptDir = result.transcriptDir
                } else {
                  effectiveSessionId = undefined
                }
              } catch {
                effectiveSessionId = undefined
              }
            } else if (self._sessionId) {
              const result = await loadAndInjectSessionMessages(self._sessionId, self.cwd, self.engine, self.resumeSessionAt)
              if (result.loaded) {
                resolvedTranscriptDir = result.transcriptDir
              } else {
                effectiveSessionId = undefined
              }
            }

            // Switch session for transcript writes using the resolved transcript dir
            if (!effectiveSessionId) {
              regenerateSessionId()
              effectiveSessionId = getSessionId()
            }
            switchSession(effectiveSessionId as SessionId, resolvedTranscriptDir)

            // Sync resolved sessionId and transcript dir back to authoritative fields
            self._sessionId = effectiveSessionId
            sdkContext.sessionId = effectiveSessionId as SessionId
            sdkContext.sessionProjectDir = resolvedTranscriptDir

            // Submit to engine
            if (typeof self.prompt === 'string') {
              for await (const engineMsg of self.engine.submitMessage(self.prompt)) {
                yield engineMsg
                yield* self.drainTimeoutQueue()
                yield* self.drainAgentFailureQueue()
              }
            } else {
              for await (const userMessage of self.prompt) {
                if (self.abortController.signal.aborted) break
                const content = extractPromptFromUserMessage(userMessage)
                for await (const engineMsg of self.engine.submitMessage(content, { uuid: userMessage.uuid })) {
                  yield engineMsg
                  yield* self.drainTimeoutQueue()
                  yield* self.drainAgentFailureQueue()
                }
              }
            }
            // Final drain for timeout/failure messages that fired on the last engine yield
            yield* self.drainTimeoutQueue()
            yield* self.drainAgentFailureQueue()
          } finally {
            // Clean up timeout and agent failure queues
            self.timeoutQueue.length = 0
            self.agentFailureQueue.length = 0
            // Restore env + release mutex (SEC-1)
            if (self.envSnapshot) {
              for (const key of Object.keys(self.envSnapshot)) {
                const originalValue = self.envSnapshot[key]
                if (originalValue === undefined) {
                  delete process.env[key]
                } else {
                  process.env[key] = originalValue
                }
              }
              self.envSnapshot = undefined
            }
            if (hasEnvOverrides) {
              releaseEnvMutex()
            }
          }
      })()
    })

    yield* inner
  }

  async setModel(model: string): Promise<void> {
    this.engine.setModel(model)
    // Also update the app state so tool context sees the new model
    this.appStateStore.setState(prev => ({
      ...prev,
      mainLoopModel: model,
      mainLoopModelForSession: model,
    }))
  }

  async setPermissionMode(mode: QueryPermissionMode): Promise<void> {
    // Preserve additionalDirectories from the original permission context
    const newPermissionContext = buildPermissionContext({
      cwd: this.cwd,
      permissionMode: mode,
      additionalDirectories: Array.from(this.permissionContext.additionalWorkingDirectories.keys()),
      allowDangerouslySkipPermissions: this.permissionContext.isBypassPermissionsModeAvailable,
    })
    this.permissionContext = newPermissionContext
    this.appStateStore.setState(prev => ({
      ...prev,
      toolPermissionContext: newPermissionContext,
    }))
    // Refresh the engine's tool list to reflect new permissions
    const updatedTools = getTools(newPermissionContext)
    this.engine.updateTools(updatedTools)
  }

  close(): void {
    this.interrupt()
    this.abortController.abort()
    // Disconnect MCP clients to prevent resource leaks
    if (this._engine?.config?.mcpClients) {
      for (const client of this._engine.config.mcpClients) {
        if (client.type === 'connected' && client.connection) {
          try {
            client.connection.close?.()
          } catch (err) {
            // Ignore cleanup errors — query is closing anyway
            console.warn('SDK: MCP client cleanup error:', err instanceof Error ? err.message : String(err))
          }
        }
      }
    }
    // Clear engine reference to prevent memory leaks
    this._engine = null
  }

  interrupt(): void {
    if (this._engine) {
      this._engine.interrupt()
    }
    this.timeoutQueue.length = 0
    this.pendingPermissionPrompts.clear()
  }

  respondToPermission(toolUseId: string, decision: PermissionResult): void {
    const pending = this.pendingPermissionPrompts.get(toolUseId)
    if (!pending) return

    if (decision.behavior === 'allow') {
      pending.resolve({
        behavior: 'allow',
        updatedInput: decision.updatedInput,
      })
    } else {
      pending.resolve({
        behavior: 'deny',
        message: decision.message ?? 'Permission denied',
        decisionReason: { type: 'mode', mode: 'default' },
      })
    }
    this.pendingPermissionPrompts.delete(toolUseId)
  }

  rewindFiles(): RewindFilesResult {
    const state = this.appStateStore.getState()
    const messages = this.engine.getMessages()

    // Find the last assistant message UUID that has a file-history snapshot
    const fileHistory = state.fileHistory
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      const messageId = (msg as any)?.uuid as string | undefined
      if (!messageId) continue

      if (fileHistoryCanRestore(fileHistory, messageId as any)) {
        // Synchronous check — return canRewind: true with the messageId.
        // Use rewindFilesAsync() to actually perform the rewind.
        return { canRewind: true }
      }
    }

    return { canRewind: false, error: 'No file-history snapshot found to rewind to' }
  }

  /**
   * Actually perform the file rewind to the last file-history snapshot.
   * Returns the files changed and diff stats if successful.
   */
  async rewindFilesAsync(): Promise<RewindFilesResult> {
    const state = this.appStateStore.getState()
    const messages = this.engine.getMessages()

    // Find the last assistant message UUID that has a file-history snapshot
    const fileHistory = state.fileHistory
    let targetMessageId: string | undefined
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      const messageId = (msg as any)?.uuid as string | undefined
      if (!messageId) continue

      if (fileHistoryCanRestore(fileHistory, messageId as any)) {
        targetMessageId = messageId
        break
      }
    }

    if (!targetMessageId) {
      return { canRewind: false, error: 'No file-history snapshot found to rewind to' }
    }

    // Get diff stats before rewinding
    const diffStats = fileHistoryGetDiffStats(fileHistory, targetMessageId as any)

    // Perform the actual rewind
    try {
      await fileHistoryRewind(
        (updater) => this.appStateStore.setState(prev => ({
          ...prev,
          fileHistory: updater(prev.fileHistory),
        })),
        targetMessageId as any,
      )

      return {
        canRewind: true,
        filesChanged: diffStats?.filesChanged,
        insertions: diffStats?.insertions ?? 0,
        deletions: diffStats?.deletions ?? 0,
      }
    } catch (err) {
      return {
        canRewind: false,
        error: err instanceof Error ? err.message : 'Rewind failed',
      }
    }
  }

  supportedCommands(): string[] {
    const state = this.appStateStore.getState()
    // Commands come from MCP servers and plugins
    const mcpCommands = state.mcp.commands?.map(c => c.name ?? c) ?? []
    const pluginCommands = state.plugins.commands?.map(c => c.name ?? c) ?? []
    return [...mcpCommands, ...pluginCommands]
  }

  supportedModels(): string[] {
    // Return the current model as the only supported model.
    // A full model catalog can be wired up later.
    const state = this.appStateStore.getState()
    const model = state.mainLoopModel
    return model ? [model] : []
  }

  supportedAgents(): string[] {
    const state = this.appStateStore.getState()
    const agents = state.agentDefinitions?.activeAgents
    return agents?.map((a: any) => a.agentType).filter(Boolean) ?? []
  }

  mcpServerStatus(): McpServerStatus[] {
    // SDK stores MCP clients in engine.config (not appStateStore like CLI).
    const clients: MCPServerConnection[] = this.engine.config.mcpClients ?? []
    return clients.map((client): McpServerStatus => {
      const base: McpServerStatus = {
        name: client.name,
        status: client.type,
      }
      if (client.type === 'connected') {
        base.serverInfo = client.serverInfo
      }
      if (client.type === 'failed') {
        base.error = (client as any).error
      }
      if ('config' in client) {
        const cfg = (client as any).config
        if (cfg?.scope) base.scope = cfg.scope
      }
      return base
    })
  }

  async accountInfo(): Promise<{ apiKeySource: ApiKeySource; [key: string]: unknown }> {
    try {
      const { getAccountInformation, getAnthropicApiKeyWithSource } = await import('../../utils/auth.js')
      const info = getAccountInformation()
      const { source: apiKeySource } = getAnthropicApiKeyWithSource()
      if (info) {
        return { apiKeySource: (info.apiKeySource ?? apiKeySource) as ApiKeySource, ...info }
      }
      return { apiKeySource: apiKeySource as ApiKeySource }
    } catch {
      return { apiKeySource: 'none' }
    }
  }

  setMaxThinkingTokens(tokens: number): void {
    this.appStateStore.setState(prev => ({
      ...prev,
      thinkingEnabled: tokens > 0,  // Boolean, not prev preservation
      thinkingBudgetTokens: tokens > 0 ? tokens : undefined,
    }))
    // Also update the engine's thinking config so subsequent API calls use the new budget
    this.engine.setThinkingConfig(tokens > 0
      ? { type: 'enabled', budgetTokens: tokens }
      : { type: 'disabled' })
  }
}

// ============================================================================
// extractPromptFromUserMessage
// ============================================================================

/**
 * Extract a prompt from an SDKUserMessage.
 *
 * SDKUserMessage.message is always an object: { role: "user", content: string | Array<unknown> }
 * per coreTypes.generated.ts. QueryEngine.submitMessage() accepts both `string` and
 * `ContentBlockParam[]`, so we extract message.content and pass through directly.
 */
function extractPromptFromUserMessage(
  msg: SDKUserMessage,
): string | Array<{ type: string; text?: string; [key: string]: unknown }> {
  const { message } = msg
  // message is always { role: "user", content: string | Array<unknown> }
  if (typeof message.content === 'string') {
    return message.content
  }
  if (Array.isArray(message.content)) {
    return message.content as Array<{ type: string; text?: string; [key: string]: unknown }>
  }
  return String(message.content ?? '')
}

// ============================================================================
// query() — core SDK function
// ============================================================================

/**
 * Start a conversation with the agent.
 *
 * Accepts a string prompt for single-shot queries or an AsyncIterable of
 * SDKUserMessage for multi-turn streaming. Returns a Query object that
 * implements AsyncIterable<SDKMessage> for consuming results.
 *
 * @example
 * ```typescript
 * // Single prompt
 * const q = query({ prompt: 'What files are in this directory?', options: { cwd: '/my/project' } })
 * for await (const message of q) {
 *   console.log(message)
 * }
 *
 * // Streaming prompts
 * async function* prompts() {
 *   yield { type: 'user', message: 'Hello' }
 * }
 * const q = query({ prompt: prompts(), options: { cwd: '/my/project' } })
 * for await (const message of q) {
 *   console.log(message)
 * }
 * ```
 */
export function query(params: {
  prompt: string | AsyncIterable<SDKUserMessage>
  options?: QueryOptions
}): Query {
  const { prompt, options = {} as QueryOptions } = params
  const {
    cwd,
    model,
    abortController,
    systemPrompt,
    settings,
  } = options

  if (!cwd) {
    throw new Error('query() requires options.cwd')
  }

  // Note: We pass settings?.env to QueryImpl for application AFTER init() runs.
  // This ensures our env vars override config file env vars, not vice versa.
  // init() calls applyConfigEnvironmentVariables() which would override pre-applied env.
  // Top-level `env` takes precedence over `settings.env` for Claude SDK compatibility.
  // NOTE: undefined values are KEPT and treated as explicit unset requests
  // (Claude SDK convention: { FOO: undefined } means "unset inherited FOO")
  const rawEnvOverrides = options.env ?? settings?.env
  const envOverrides: Record<string, string | undefined> | undefined = rawEnvOverrides

  // Ensure init() has been called (memoized, safe to call multiple times).
  // We fire-and-forget the init promise — QueryEngine.submitMessage() will
  // be awaited by the consumer, which naturally waits for the async iter.
  // However, we must ensure init completes before proceeding, so we wrap
  // the whole setup in an async helper. Since query() must return a Query
  // synchronously (so the caller can use for-await), we create the Query
  // eagerly and let the async iteration handle the init await.
  //
  // Alternative: make query() async. But the agentSdkTypes signature returns
  // Query synchronously (not Promise<Query>), so we keep it sync and defer
  // the init to the async iterator.

  // NOTE: cwd is NOT set on global state here. It is set inside the
  // async iterator via withSessionCwd() to prevent concurrent sessions
  // from overwriting each other's working directory.

  // Build permission context
  const permissionContext = buildPermissionContext(options)

  // Create AppState store (minimal, headless)
  const initialAppState = getDefaultAppState()
  // Override the permission context in the initial state
  const stateWithPermissions = {
    ...initialAppState,
    toolPermissionContext: permissionContext,
  }
  if (model) {
    stateWithPermissions.mainLoopModel = model
    stateWithPermissions.mainLoopModelForSession = model
  }
  const appStateStore = createStore<AppState>(stateWithPermissions)

  // Get tools filtered by permission context
  const tools = getTools(permissionContext)

  // Create file state cache
  const readFileCache = createFileStateCacheWithSizeLimit(100)

  // Build the canUseTool callback
  const defaultCanUseTool = createDefaultCanUseTool(permissionContext)

  // Determine custom system prompt
  let customSystemPrompt: string | undefined
  let appendSystemPrompt: string | undefined
  if (typeof systemPrompt === 'string') {
    customSystemPrompt = systemPrompt
  } else if (systemPrompt?.type === 'custom') {
    customSystemPrompt = systemPrompt.content
  } else if (systemPrompt?.type === 'preset') {
    if (systemPrompt.append) {
      appendSystemPrompt = systemPrompt.append
    }
  }

  // Abort controller
  const ac = abortController ?? new AbortController()

  // Create the Query wrapper first so we can wire canUseTool to its
  // pending permission map. Pass envOverrides for application AFTER init().
  // Also pass sessionId, fork/forkSession, continue, cwd, resumeSessionAt, and agents.
  const effectiveSessionId = options.sessionId || options.resume
  const shouldFork = options.fork || options.forkSession
  const queryImpl = new QueryImpl(null, prompt, ac, appStateStore, envOverrides, effectiveSessionId, shouldFork, options.continue, cwd, options.resumeSessionAt, options.agents, options.mcpServers, permissionContext)

  // Build the canUseTool that supports external permission resolution.
  // When no user canUseTool callback is provided, this creates a pending
  // prompt entry that respondToPermission() can resolve asynchronously.
  // Pass sessionId so permission_request messages have correct session_id.
  const externalCanUseTool = createExternalCanUseTool(
    options.canUseTool,
    defaultCanUseTool,
    queryImpl,
    options.onPermissionRequest,
    (msg) => { queryImpl.pushTimeout(msg) },
    options._permissionTimeoutMs ?? 30000,
    effectiveSessionId,
  )

  // Create QueryEngine config
  const engineConfig = {
    cwd,
    tools,
    commands: [] as Array<never>,
    mcpClients: [],
    agents: [],
    canUseTool: externalCanUseTool,
    getAppState: () => appStateStore.getState(),
    setAppState: (f: (prev: AppState) => AppState) => appStateStore.setState(f),
    readFileCache,
    customSystemPrompt,
    appendSystemPrompt,
    userSpecifiedModel: model,
    abortController: ac,
    includePartialMessages: options.includePartialMessages ?? false,
  }

  // Create the QueryEngine
  const engine = new QueryEngine(engineConfig)

  // Wire the engine into QueryImpl (was null during construction)
  queryImpl.setEngine(engine)

  return queryImpl
}

/**
 * Async version of query() that ensures init() has completed before
 * returning. This is the recommended entry point for programmatic usage
 * where you want to guarantee initialization is done before consuming messages.
 *
 * The synchronous query() defers init to the async iterator; this version
 * awaits it upfront.
 */
export async function queryAsync(params: {
  prompt: string | AsyncIterable<SDKUserMessage>
  options?: QueryOptions
}): Promise<Query> {
  await init()
  return query(params)
}
