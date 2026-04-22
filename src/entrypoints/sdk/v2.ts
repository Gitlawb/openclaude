/**
 * V2 API for the SDK — persistent sessions and one-shot prompt.
 *
 * Provides SDKSession, SDKSessionImpl, createEngineFromOptions,
 * and the unstable_v2_* functions.
 */

import { randomUUID } from 'crypto'
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import { QueryEngine } from '../../QueryEngine.js'
import {
  getDefaultAppState,
  type AppState,
} from '../../state/AppStateStore.js'
import { createStore, type Store } from '../../state/store.js'
import {
  type ToolPermissionContext,
} from '../../Tool.js'
import { getTools } from '../../tools.js'
import { createFileStateCacheWithSizeLimit } from '../../utils/fileStateCache.js'
import { init } from '../init.js'
import {
  resolveSessionFilePath,
} from '../../utils/sessionStoragePortable.js'
import { readJSONLFile } from '../../utils/json.js'
import {
  getOriginalCwd,
  switchSession,
  getSessionProjectDir,
  runWithSdkContext,
} from '../../bootstrap/state.js'
import type { SessionId } from '../../types/ids.js'
import { getAgentDefinitionsWithOverrides } from '../../tools/AgentTool/loadAgentsDir.js'
import type {
  PermissionResult,
  SDKResultMessage as GeneratedSDKResultMessage,
} from './sdk/coreTypes.generated.js'
import type {
  SDKMessage,
  SDKPermissionTimeoutMessage,
  JsonlEntry,
  QueryPermissionMode,
  CanUseToolCallback,
  SDKPermissionRequestMessage,
} from './shared.js'
import {
  assertValidSessionId,
  mapMessageToSDK,
} from './shared.js'
import {
  buildPermissionContext,
  createExternalCanUseTool,
  connectSdkMcpServers,
  createDefaultCanUseTool,
  type PermissionResolveDecision,
} from './permissions.js'

// ============================================================================
// V2 API Types
// ============================================================================

/**
 * Options for creating a persistent SDK session.
 * Used by unstable_v2_createSession and unstable_v2_resumeSession.
 */
export type SDKSessionOptions = {
  /** Working directory for the session. Required. */
  cwd: string
  /** Model to use (e.g. 'claude-sonnet-4-6'). */
  model?: string
  /** Permission mode for tool access. */
  permissionMode?: QueryPermissionMode
  /** AbortController to cancel the session. */
  abortController?: AbortController
  /**
   * Callback invoked before each tool use. Return `{ behavior: 'allow' }` to
   * permit the call or `{ behavior: 'deny', message?: string }` to reject it.
   *
   * **Secure-by-default**: If neither `canUseTool` nor `onPermissionRequest`
   * is provided, ALL tool uses are denied. You MUST provide at least one of
   * these callbacks to allow tool execution.
   */
  canUseTool?: CanUseToolCallback
  /** MCP server configurations for this session. */
  mcpServers?: Record<string, unknown>
  /**
   * Callback invoked when a tool needs permission approval. The host receives
   * the request immediately and can resolve it via respondToPermission().
   */
  onPermissionRequest?: (message: SDKPermissionRequestMessage) => void
}

/**
 * A persistent session wrapping a QueryEngine for multi-turn conversations.
 *
 * Each call to `sendMessage` starts a new turn within the same conversation.
 * State (messages, file cache, usage, etc.) persists across turns.
 */
export interface SDKSession {
  /** Unique identifier for this session. */
  sessionId: string
  /** Send a message and yield responses as an AsyncIterable of SDKMessage. */
  sendMessage(content: string): AsyncIterable<SDKMessage>
  /** Return all messages accumulated so far in this session. */
  getMessages(): SDKMessage[]
  /** Abort the current in-flight query. */
  interrupt(): void
  /**
   * Respond to a pending permission prompt asynchronously.
   * Use this when no canUseTool callback was provided — the SDK emits a
   * permission-request message and the host resolves it via this method.
   */
  respondToPermission(toolUseId: string, decision: PermissionResult): void
}

/**
 * An SDKResultMessage is the final message emitted by a query turn,
 * containing the result text, usage stats, and cost information.
 * Re-exports the full generated type from coreTypes.generated.ts.
 */
export type SDKResultMessage = GeneratedSDKResultMessage

// ============================================================================
// SdkMcpToolDefinition — tool() return type
// ============================================================================

/**
 * Describes a tool definition created by the `tool()` factory function.
 * These definitions can be passed to `createSdkMcpServer()` to register
 * custom MCP tools.
 */
export interface SdkMcpToolDefinition<Schema = any> {
  name: string
  description: string
  inputSchema: Schema
  handler: (args: any, extra: unknown) => Promise<CallToolResult>
  annotations?: ToolAnnotations
  searchHint?: string
  alwaysLoad?: boolean
}

// ============================================================================
// SDKSessionImpl — concrete SDKSession
// ============================================================================

class SDKSessionImpl implements SDKSession {
  private _engine: QueryEngine | null = null
  private get engine(): QueryEngine {
    if (!this._engine) {
      throw new Error('SDKSessionImpl: engine not initialized. Call setEngine() first.')
    }
    return this._engine
  }
  private _sessionId: string
  private options: SDKSessionOptions
  private _appStateStore: Store<AppState> | null = null
  private get appStateStore(): Store<AppState> {
    if (!this._appStateStore) {
      throw new Error('SDKSessionImpl: appStateStore not initialized. Call setAppStateStore() first.')
    }
    return this._appStateStore
  }
  private agentsLoaded = false
  private mcpServers?: Record<string, unknown>
  private mcpConnected = false
  private pendingPermissionPrompts = new Map<string, {
    resolve: (decision: PermissionResolveDecision) => void
  }>()
  private timeoutQueue: SDKPermissionTimeoutMessage[] = []

  constructor(
    engine: QueryEngine | null,
    sessionId: string,
    options: SDKSessionOptions,
    appStateStore: Store<AppState> | null,
  ) {
    if (engine) this._engine = engine
    this._sessionId = sessionId
    this.options = options
    if (appStateStore) this._appStateStore = appStateStore
    this.mcpServers = options.mcpServers
  }

  /** Late-bind the engine (used when session is created before engine). */
  setEngine(engine: QueryEngine): void {
    this._engine = engine
  }

  /** Late-bind the app state store (used when session is created before store). */
  setAppStateStore(store: Store<AppState>): void {
    this._appStateStore = store
  }

  get sessionId(): string {
    return this._sessionId
  }

  async *sendMessage(content: string): AsyncIterable<SDKMessage> {
    const sdkContext = {
      sessionId: this._sessionId as SessionId,
      sessionProjectDir: getSessionProjectDir() ?? getOriginalCwd(),
      cwd: this.options.cwd,
      originalCwd: this.options.cwd,
    }

    const self = this
    const inner = runWithSdkContext(sdkContext, () => {
      return (async function* (): AsyncIterator<SDKMessage> {
        await init()

        // Load agent definitions once (not on every sendMessage call)
        if (!self.agentsLoaded) {
          try {
            const agentDefs = await getAgentDefinitionsWithOverrides(self.options.cwd)
            self.appStateStore.setState(prev => ({
              ...prev,
              agentDefinitions: agentDefs,
            }))
            if (agentDefs.activeAgents.length > 0) {
              self.engine.injectAgents(agentDefs.activeAgents)
            }
          } catch {
            // Agent loading failed — continue without agents
          }
          self.agentsLoaded = true
        }

        // Connect MCP servers once (lazy, on first message)
        if (!self.mcpConnected && self.mcpServers && Object.keys(self.mcpServers).length > 0) {
          const { clients: mcpClients, tools: mcpTools } = await connectSdkMcpServers(self.mcpServers)
          if (mcpClients.length > 0) {
            self.engine.config.mcpClients = mcpClients
            const permissionContext = (self.appStateStore.getState() as any).toolPermissionContext as ToolPermissionContext
            const allTools = getTools(permissionContext)
            for (const mcpTool of mcpTools) {
              if (!allTools.some(t => t.name === mcpTool.name)) {
                allTools.push(mcpTool)
              }
            }
            self.engine.updateTools(allTools)
          }
          self.mcpConnected = true
        }

        // Switch session for transcript writes
        const projectDir = getSessionProjectDir() ?? getOriginalCwd()
        switchSession(self._sessionId as SessionId, projectDir)

        for await (const engineMsg of self.engine.submitMessage(content)) {
          yield engineMsg
          yield* self.drainTimeoutQueue()
        }
        // Final drain for timeout messages that fired on the last engine yield
        yield* self.drainTimeoutQueue()
      })()
    })

    yield* inner
  }

  getMessages(): SDKMessage[] {
    return this.engine.getMessages().map(msg => mapMessageToSDK(msg as Record<string, unknown>))
  }

  interrupt(): void {
    this.engine.interrupt()
    this.timeoutQueue.length = 0
  }

  /**
   * Register a pending permission prompt for external resolution.
   * Returns a Promise that resolves when respondToPermission() is called
   * with the matching toolUseId.
   */
  registerPendingPermission(toolUseId: string): Promise<PermissionResolveDecision> {
    return new Promise(resolve => {
      this.pendingPermissionPrompts.set(toolUseId, { resolve })
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
}

// ============================================================================
// createEngineFromOptions
// ============================================================================

/**
 * Shared helper that builds a QueryEngine and its supporting state from
 * SDKSessionOptions. Used by both createSession and resumeSession.
 */
function createEngineFromOptions(
  options: SDKSessionOptions,
  permissionTarget: { registerPendingPermission(toolUseId: string): Promise<PermissionResolveDecision>; pendingPermissionPrompts: Map<string, { resolve: (decision: PermissionResolveDecision) => void }>; pushTimeout?: (msg: SDKPermissionTimeoutMessage) => void },
  initialMessages?: any[],
): { engine: QueryEngine; appStateStore: Store<AppState> } {
  const { cwd, model, abortController, permissionMode } = options

  if (!cwd) {
    throw new Error('SDKSessionOptions requires cwd')
  }

  // NOTE: cwd is NOT set on global state here. SDKSessionImpl.sendMessage()
  // sets/restores it per-message via the cwd mutex to prevent concurrent
  // sessions from overwriting each other's working directory.

  // Build permission context
  const permissionContext = buildPermissionContext({
    cwd,
    permissionMode,
  })

  // Create AppState store (minimal, headless)
  const initialAppState = getDefaultAppState()
  const stateWithPermissions = {
    ...initialAppState,
    toolPermissionContext: permissionContext,
  }
  if (model) {
    stateWithPermissions.mainLoopModel = model
    stateWithPermissions.mainLoopModelForSession = model
  }
  const appStateStore = createStore<AppState>(stateWithPermissions)

  // Build thinkingConfig from initial state
  const thinkingConfig = stateWithPermissions.thinkingEnabled !== false
    ? (stateWithPermissions.thinkingBudgetTokens
      ? { type: 'enabled' as const, budgetTokens: stateWithPermissions.thinkingBudgetTokens }
      : { type: 'adaptive' as const })
    : { type: 'disabled' as const }

  // Get tools filtered by permission context
  const tools = getTools(permissionContext)

  // Create file state cache
  const readFileCache = createFileStateCacheWithSizeLimit(100)

  // Build the canUseTool callback with external permission resolution support.
  // When no user canUseTool callback is provided, this creates a pending
  // prompt entry that respondToPermission() can resolve asynchronously.
  const defaultCanUseTool = createDefaultCanUseTool(permissionContext)
  const canUseTool = createExternalCanUseTool(
    options.canUseTool ?? undefined,
    defaultCanUseTool,
    permissionTarget,
    options.onPermissionRequest,
    (msg) => { permissionTarget.pushTimeout?.(msg) },
  )

  // Abort controller
  const ac = abortController ?? new AbortController()

  // Create QueryEngine config
  const engineConfig = {
    cwd,
    tools,
    commands: [] as Array<never>,
    mcpClients: [],
    agents: [],
    canUseTool,
    getAppState: () => appStateStore.getState(),
    setAppState: (f: (prev: AppState) => AppState) => appStateStore.setState(f),
    readFileCache,
    userSpecifiedModel: model,
    abortController: ac,
    thinkingConfig,
    ...(initialMessages ? { initialMessages } : {}),
  }

  const engine = new QueryEngine(engineConfig)

  return { engine, appStateStore }
}

// ============================================================================
// V2 API Functions
// ============================================================================

/**
 * V2 API - UNSTABLE
 * Creates a persistent SDKSession wrapping a QueryEngine for multi-turn
 * conversations.
 *
 * @alpha
 *
 * @example
 * ```typescript
 * const session = unstable_v2_createSession({ cwd: '/my/project' })
 * for await (const msg of session.sendMessage('Hello!')) {
 *   console.log(msg)
 * }
 * // Continue the conversation:
 * for await (const msg of session.sendMessage('What did I just say?')) {
 *   console.log(msg)
 * }
 * ```
 */
export function unstable_v2_createSession(options: SDKSessionOptions): SDKSession {
  const sessionId = randomUUID()
  // Create SDKSessionImpl first (without engine) so we can pass its
  // pendingPermissionPrompts map to createEngineFromOptions for
  // external permission resolution support.
  const session = new SDKSessionImpl(null, sessionId, options, null)
  const { engine, appStateStore } = createEngineFromOptions(options, session)
  // Wire the engine and store into the session
  session.setEngine(engine)
  session.setAppStateStore(appStateStore)
  return session
}

/**
 * V2 API - UNSTABLE
 * Resume an existing session by ID. Loads the session's prior messages
 * from disk and passes them to the QueryEngine so the conversation
 * continues from where it left off.
 *
 * @alpha
 *
 * @param sessionId - UUID of the session to resume
 * @param options - Session options (cwd is required)
 * @returns SDKSession with prior conversation history loaded
 *
 * @example
 * ```typescript
 * const session = await unstable_v2_resumeSession(sessionId, { cwd: '/my/project' })
 * for await (const msg of session.sendMessage('Continue where we left off')) {
 *   console.log(msg)
 * }
 * ```
 */
export async function unstable_v2_resumeSession(
  sessionId: string,
  options: SDKSessionOptions,
): Promise<SDKSession> {
  assertValidSessionId(sessionId)

  // Load prior messages directly from JSONL (preserves sidechain/tool history)
  //getSessionMessages filters out sidechain entries which breaks tool-result chains
  const resolved = await resolveSessionFilePath(sessionId, options.cwd)
  const rawEntries = resolved ? await readJSONLFile<JsonlEntry>(resolved.filePath) : []

  // Filter to user/assistant entries (same as loadAndInjectSessionMessages)
  const initialMessages = rawEntries
    .filter(entry => !entry.isSidechain && (entry.type === 'user' || entry.type === 'assistant'))
    .map(entry => ({ ...entry }))

  const session = new SDKSessionImpl(null, sessionId, options, null)
  const { engine, appStateStore } = createEngineFromOptions(
    options,
    session,
    initialMessages as any[],
  )
  session.setEngine(engine)
  session.setAppStateStore(appStateStore)
  return session
}

// @[MODEL LAUNCH]: Update the example model ID in this docstring.
/**
 * V2 API - UNSTABLE
 * One-shot convenience: creates a session, sends a single prompt, collects
 * the SDKResultMessage, and returns it.
 *
 * @alpha
 *
 * @example
 * ```typescript
 * const result = await unstable_v2_prompt("What files are here?", {
 *   cwd: '/my/project',
 *   model: 'claude-sonnet-4-6',
 * })
 * console.log(result.result) // text output
 * ```
 */
export async function unstable_v2_prompt(
  message: string,
  options: SDKSessionOptions,
): Promise<SDKResultMessage> {
  const session = unstable_v2_createSession(options)

  let resultMessage: SDKResultMessage | undefined

  for await (const msg of session.sendMessage(message)) {
    if (msg.type === 'result') {
      resultMessage = msg as SDKResultMessage
    }
  }

  if (!resultMessage) {
    throw new Error('unstable_v2_prompt: query completed without a result message')
  }

  return resultMessage
}
