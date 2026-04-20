/**
 * SDK entry point — session management functions and query().
 *
 * This file is bundled as `dist/sdk.mjs` separately from the CLI.
 * It must NOT import React, Ink, or any CLI/TUI code.
 *
 * All session data is read from JSONL files on disk using existing portable
 * utilities that have no heavy dependencies.
 */

import { randomUUID } from 'crypto'
import type { UUID } from 'crypto'
import { appendFile, mkdir, unlink, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import type { CanUseToolFn } from '../hooks/useCanUseTool.js'
import { QueryEngine } from '../QueryEngine.js'
import {
  getDefaultAppState,
  type AppState,
} from '../state/AppStateStore.js'
import { createStore, type Store } from '../state/store.js'
import {
  getEmptyToolPermissionContext,
  type ToolPermissionContext,
  type Tool,
} from '../Tool.js'
import { getTools } from '../tools.js'
import { createFileStateCacheWithSizeLimit } from '../utils/fileStateCache.js'
import { init } from './init.js'
import {
  listSessionsImpl,
  parseSessionInfoFromLite,
  type SessionInfo,
} from '../utils/listSessionsImpl.js'
import {
  readSessionLite,
  resolveSessionFilePath,
  validateUuid,
} from '../utils/sessionStoragePortable.js'
import { readJSONLFile } from '../utils/json.js'
import { setCwd } from '../utils/Shell.js'
import {
  setOriginalCwd,
  getCwdState,
  getOriginalCwd,
  setCwdState,
  switchSession,
  getSessionProjectDir,
  regenerateSessionId,
  getSessionId,
} from '../bootstrap/state.js'
import { getAgentDefinitionsWithOverrides } from '../tools/AgentTool/loadAgentsDir.js'
import type {
  RewindFilesResult,
  McpServerStatus,
  ApiKeySource,
  PermissionResult,
  SDKMessage as GeneratedSDKMessage,
  SDKUserMessage as GeneratedSDKUserMessage,
  SDKResultMessage as GeneratedSDKResultMessage,
} from './sdk/coreTypes.generated.js'
import {
  AbortError,
  ClaudeError,
  SDKAuthenticationError,
  SDKBillingError,
  SDKRateLimitError,
  SDKInvalidRequestError,
  SDKServerError,
  SDKMaxOutputTokensError,
  sdkErrorFromType,
} from '../utils/errors.js'
import type { SDKAssistantMessageError } from '../utils/errors.js'
import {
  fileHistoryCanRestore,
  fileHistoryGetDiffStats,
  fileHistoryRewind,
  type FileHistoryState,
} from '../utils/fileHistory.js'
import type { MCPServerConnection, ScopedMcpServerConfig } from '../services/mcp/types.js'
import { filterToolsByServer } from '../services/mcp/utils.js'
import { connectToServer, fetchToolsForClient } from '../services/mcp/client.js'
import type { ThinkingConfig } from '../utils/thinking.js'

/**
 * One-time check that detects TUI/CLI component stubs leaking into the SDK
 * runtime. The esbuild sdk-missing-stub plugin marks every stub with
 * `__stub: true`. If a core SDK dependency resolved to such a stub, it means
 * a TUI import leaked through — fail loudly instead of silently nooping.
 */
function detectStubLeaks(): void {
  // List of modules that are imported by this file and must NOT be stubs.
  // We check the imported objects for the __stub marker.
  const criticalImports: Array<{ name: string; mod: Record<string, unknown> }> = [
    { name: 'QueryEngine', mod: QueryEngine as unknown as Record<string, unknown> },
  ]

  for (const { name, mod } of criticalImports) {
    if ('__stub' in mod && mod.__stub === true) {
      throw new Error(
        `SDK init error: "${name}" resolved to a build stub at runtime. ` +
        `This means a TUI/CLI dependency leaked into the SDK bundle. ` +
        `Report this at https://github.com/Gitlawb/openclaude/issues`,
      )
    }
  }
}

// Run leak detection once at module load time.
detectStubLeaks()

/**
 * Validate sessionId is a proper UUID to prevent path traversal.
 * Throws if invalid.
 */
function assertValidSessionId(sessionId: string): void {
  if (!validateUuid(sessionId)) {
    throw new Error(`Invalid session ID: ${sessionId}`)
  }
}

// ============================================================================
// Environment mutation mutex for parallel query safety
// ============================================================================

/**
 * Global mutex for process.env mutations.
 * Prevents race conditions when multiple queries run in parallel.
 */
const envMutationQueue: Array<() => void> = []
let envMutationLocked = false

function acquireEnvMutex(): Promise<void> {
  if (!envMutationLocked) {
    envMutationLocked = true
    return Promise.resolve()
  }
  return new Promise(resolve => {
    envMutationQueue.push(resolve)
  })
}

function releaseEnvMutex(): void {
  if (envMutationQueue.length > 0) {
    const next = envMutationQueue.shift()
    if (next) next()
  } else {
    envMutationLocked = false
  }
}

// ============================================================================
// Cwd mutex for parallel session safety
// ============================================================================

/**
 * Global mutex for global cwd state mutations (STATE.cwd, STATE.originalCwd).
 * Prevents concurrent SDK sessions from overwriting each other's working directory.
 */
const cwdMutexQueue: Array<() => void> = []
let cwdMutexLocked = false

function acquireCwdMutex(): Promise<void> {
  if (!cwdMutexLocked) {
    cwdMutexLocked = true
    return Promise.resolve()
  }
  return new Promise(resolve => {
    cwdMutexQueue.push(resolve)
  })
}

function releaseCwdMutex(): void {
  if (cwdMutexQueue.length > 0) {
    const next = cwdMutexQueue.shift()
    if (next) next()
  } else {
    cwdMutexLocked = false
  }
}

// ============================================================================
// SDK Types — snake_case public interface
// ============================================================================

/**
 * A message emitted by the query engine during a conversation.
 * Re-exports the full generated type from coreTypes.generated.ts.
 */
export type SDKMessage = GeneratedSDKMessage

/**
 * A user message fed into query() via AsyncIterable.
 * Re-exports the full generated type from coreTypes.generated.ts.
 */
export type SDKUserMessage = GeneratedSDKUserMessage

/**
 * Map an internal Message object to an SDKMessage.
 * Internal messages have a different shape from SDK types — this function
 * performs the conversion instead of relying on unsafe casts.
 */
function mapMessageToSDK(msg: Record<string, unknown>): SDKMessage {
  // Internal messages from QueryEngine already use the SDK field naming
  // convention (snake_case: parent_tool_use_id, session_id, etc.).
  // We spread all fields through and let the discriminated-union type
  // narrow via the `type` field.
  return {
    ...msg,
    type: (msg.type as string) ?? 'unknown',
  } as SDKMessage
}

/**
 * Session metadata returned by listSessions and getSessionInfo.
 * Uses snake_case field names matching the public SDK contract.
 */
export type SDKSessionInfo = {
  session_id: string
  summary: string
  last_modified: number
  file_size?: number
  custom_title?: string
  first_prompt?: string
  git_branch?: string
  cwd?: string
  tag?: string
  created_at?: number
}

/** Options for listSessions. */
export type ListSessionsOptions = {
  /** Project directory. When omitted, returns sessions across all projects. */
  dir?: string
  /** Maximum number of sessions to return. */
  limit?: number
  /** Number of sessions to skip (pagination). */
  offset?: number
  /** Include git worktree sessions (default true). */
  includeWorktrees?: boolean
}

/** Options for getSessionInfo. */
export type GetSessionInfoOptions = {
  /** Project directory. When omitted, searches all project directories. */
  dir?: string
}

/** Options for getSessionMessages. */
export type GetSessionMessagesOptions = {
  /** Project directory. When omitted, searches all project directories. */
  dir?: string
  /** Maximum number of messages to return. */
  limit?: number
  /** Number of messages to skip (pagination). */
  offset?: number
  /** Include system messages in the output. Default false. */
  includeSystemMessages?: boolean
}

/** Options for renameSession and tagSession. */
export type SessionMutationOptions = {
  /** Project directory. When omitted, searches all project directories. */
  dir?: string
}

/** Options for forkSession. */
export type ForkSessionOptions = {
  /** Project directory. When omitted, searches all project directories. */
  dir?: string
  /** Fork up to (and including) this message UUID. */
  upToMessageId?: string
  /** Title for the forked session. */
  title?: string
}

/** Result of forkSession. */
export type ForkSessionResult = {
  /** UUID of the newly created forked session. */
  session_id: string
}

/**
 * A single message in a session conversation.
 * Returned by getSessionMessages.
 */
export type SessionMessage = {
  role: 'user' | 'assistant' | 'system'
  content: unknown
  timestamp?: string
  uuid?: string
  parent_uuid?: string | null
  [key: string]: unknown
}

// ============================================================================
// Internal: SessionInfo → SDKSessionInfo mapping
// ============================================================================

function toSDKSessionInfo(info: SessionInfo): SDKSessionInfo {
  return {
    session_id: info.sessionId,
    summary: info.summary,
    last_modified: info.lastModified,
    file_size: info.fileSize,
    custom_title: info.customTitle,
    first_prompt: info.firstPrompt,
    git_branch: info.gitBranch,
    cwd: info.cwd,
    tag: info.tag,
    created_at: info.createdAt,
  }
}

// ============================================================================
// Session functions
// ============================================================================

/**
 * List sessions with metadata.
 *
 * When `dir` is provided, returns sessions for that project directory
 * and its git worktrees. When omitted, returns sessions across all projects.
 *
 * Use `limit` and `offset` for pagination.
 */
export async function listSessions(
  options?: ListSessionsOptions,
): Promise<SDKSessionInfo[]> {
  const sessions = await listSessionsImpl(options)
  return sessions.map(toSDKSessionInfo)
}

/**
 * Reads metadata for a single session by ID.
 * Returns undefined if the session file is not found, is a sidechain session,
 * or has no extractable summary.
 *
 * @param sessionId - UUID of the session
 * @param options - Optional dir to narrow the search
 */
export async function getSessionInfo(
  sessionId: string,
  options?: GetSessionInfoOptions,
): Promise<SDKSessionInfo | undefined> {
  assertValidSessionId(sessionId)
  const resolved = await resolveSessionFilePath(sessionId, options?.dir)
  if (!resolved) return undefined

  const lite = await readSessionLite(resolved.filePath)
  if (!lite) return undefined

  const info = parseSessionInfoFromLite(
    sessionId,
    lite,
    resolved.projectPath,
  )
  if (!info) return undefined

  return toSDKSessionInfo(info)
}

// ============================================================================
// Internal: JSONL line types used by getSessionMessages and forkSession
// ============================================================================

type JsonlEntry = {
  type: string
  uuid?: string
  parentUuid?: string | null
  sessionId?: string
  timestamp?: string
  message?: {
    role?: string
    content?: unknown
    [key: string]: unknown
  }
  isSidechain?: boolean
  [key: string]: unknown
}

/**
 * Reads a session's conversation messages from its JSONL transcript file.
 *
 * Parses the transcript, builds the conversation chain via parentUuid links,
 * and returns user/assistant messages in chronological order. Set
 * `includeSystemMessages: true` in options to also include system messages.
 *
 * @param sessionId - UUID of the session to read
 * @param options - Optional dir, limit, offset, and includeSystemMessages
 * @returns Array of messages, or empty array if session not found
 */
export async function getSessionMessages(
  sessionId: string,
  options?: GetSessionMessagesOptions,
): Promise<SessionMessage[]> {
  assertValidSessionId(sessionId)
  const resolved = await resolveSessionFilePath(sessionId, options?.dir)
  if (!resolved) return []

  const entries = await readJSONLFile<JsonlEntry>(resolved.filePath)
  if (entries.length === 0) return []

  // Build map of uuid → entry, filter non-message entries
  const byUuid = new Map<string, JsonlEntry>()
  for (const entry of entries) {
    if (!entry.uuid) continue
    // Skip sidechain entries
    if (entry.isSidechain) continue
    // Only include entries with a meaningful type
    const role = entryToRole(entry)
    if (role === null) continue
    byUuid.set(entry.uuid, entry)
  }

  if (byUuid.size === 0) return []

  // Find the leaf (last entry that has a uuid and valid role)
  let leaf: JsonlEntry | undefined
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]
    if (entry?.uuid && byUuid.has(entry.uuid)) {
      leaf = entry
      break
    }
  }
  if (!leaf) return []

  // Build conversation chain by walking parentUuid from leaf to root
  const chain: JsonlEntry[] = []
  const seen = new Set<string>()
  let current: JsonlEntry | undefined = leaf
  while (current) {
    if (!current.uuid || seen.has(current.uuid)) break
    seen.add(current.uuid)
    chain.push(current)
    const parentRef: string | null | undefined = current.parentUuid
    current = parentRef ? byUuid.get(parentRef) : undefined
  }
  chain.reverse()

  // Map to SessionMessage
  const includeSystem = options?.includeSystemMessages ?? false
  let messages: SessionMessage[] = chain
    .filter(entry => {
      const role = entryToRole(entry)
      if (role === 'system') return includeSystem
      return role !== null
    })
    .map(entry => entryToSessionMessage(entry))

  // Apply offset/limit
  const offset = options?.offset ?? 0
  if (offset > 0) messages = messages.slice(offset)
  const limit = options?.limit
  if (limit !== undefined && limit > 0) messages = messages.slice(0, limit)

  return messages
}

/**
 * Determine the role of a JSONL entry, or null if it's not a conversational message.
 */
function entryToRole(entry: JsonlEntry): 'user' | 'assistant' | 'system' | null {
  switch (entry.type) {
    case 'user':
      return 'user'
    case 'assistant':
      return 'assistant'
    case 'summary':
    case 'system':
      return 'system'
    default:
      return null
  }
}

/**
 * Convert a JSONL entry to a SessionMessage.
 */
function entryToSessionMessage(entry: JsonlEntry): SessionMessage {
  const role = entryToRole(entry) ?? 'system'
  return {
    role,
    content: entry.message?.content,
    timestamp: entry.timestamp,
    uuid: entry.uuid,
    parent_uuid: entry.parentUuid,
  }
}

// ============================================================================
// Internal: append a JSONL entry to a session file (portable, no heavy deps)
// ============================================================================

async function appendJsonlEntry(
  filePath: string,
  entry: Record<string, unknown>,
): Promise<void> {
  const line = JSON.stringify(entry) + '\n'
  try {
    await appendFile(filePath, line, { mode: 0o600 })
  } catch {
    await mkdir(dirname(filePath), { mode: 0o700, recursive: true })
    await appendFile(filePath, line, { mode: 0o600 })
  }
}

// ============================================================================
// Session mutation functions
// ============================================================================

/**
 * Rename a session. Appends a custom-title entry to the session's JSONL file.
 *
 * @param sessionId - UUID of the session
 * @param title - New title
 * @param options - Optional dir to narrow the search
 */
export async function renameSession(
  sessionId: string,
  title: string,
  options?: SessionMutationOptions,
): Promise<void> {
  assertValidSessionId(sessionId)
  const resolved = await resolveSessionFilePath(sessionId, options?.dir)
  if (!resolved) {
    throw new Error(`Session not found: ${sessionId}`)
  }

  await appendJsonlEntry(resolved.filePath, {
    type: 'custom-title',
    customTitle: title,
    sessionId,
  })
}

/**
 * Tag a session. Pass null to clear the tag.
 *
 * @param sessionId - UUID of the session
 * @param tag - Tag string, or null to clear
 * @param options - Optional dir to narrow the search
 */
export async function tagSession(
  sessionId: string,
  tag: string | null,
  options?: SessionMutationOptions,
): Promise<void> {
  assertValidSessionId(sessionId)
  const resolved = await resolveSessionFilePath(sessionId, options?.dir)
  if (!resolved) {
    throw new Error(`Session not found: ${sessionId}`)
  }

  await appendJsonlEntry(resolved.filePath, {
    type: 'tag',
    tag: tag ?? '',
    sessionId,
  })
}

/**
 * Delete a session by removing its JSONL file from disk.
 *
 * @param sessionId - UUID of the session to delete
 * @param options - Optional dir to narrow the search
 * @throws If sessionId is invalid or session file is not found
 */
export async function deleteSession(
  sessionId: string,
  options?: SessionMutationOptions,
): Promise<void> {
  assertValidSessionId(sessionId)
  const resolved = await resolveSessionFilePath(sessionId, options?.dir)
  if (!resolved) {
    throw new Error(`Session not found: ${sessionId}`)
  }

  await unlink(resolved.filePath)
}

// ============================================================================
// forkSession
// ============================================================================

/**
 * Fork a session into a new branch with fresh UUIDs.
 *
 * Copies transcript messages from the source session into a new session file,
 * remapping every message UUID and preserving the parentUuid chain. Supports
 * `upToMessageId` for branching from a specific point in the conversation.
 *
 * Forked sessions start without undo history (file-history snapshots are not
 * copied).
 *
 * @param sessionId - UUID of the source session
 * @param options - Optional dir, upToMessageId, title
 * @returns Object with the new session_id
 */
export async function forkSession(
  sessionId: string,
  options?: ForkSessionOptions,
): Promise<ForkSessionResult> {
  assertValidSessionId(sessionId)
  const resolved = await resolveSessionFilePath(sessionId, options?.dir)
  if (!resolved) {
    throw new Error(`Session not found: ${sessionId}`)
  }

  // Read all JSONL entries
  const entries = await readJSONLFile<JsonlEntry>(resolved.filePath)
  if (entries.length === 0) {
    throw new Error(`Session is empty: ${sessionId}`)
  }

  // Generate new session ID and UUID remapping
  const forkSessionId = randomUUID() as UUID

  // Determine the target directory: same as source
  const targetDir = dirname(resolved.filePath)
  const forkPath = join(targetDir, `${forkSessionId}.jsonl`)

  // UUID remapping: old UUID → new UUID
  const uuidMap = new Map<string, UUID>()

  // Filter to main conversation entries only (no sidechains)
  // If upToMessageId is specified, stop at that message
  const mainEntries: JsonlEntry[] = []
  let hitUpTo = false
  for (const entry of entries) {
    if (entry.isSidechain) continue
    if (!entry.uuid) continue

    // Only include conversational entries
    const role = entryToRole(entry)
    if (role === null) {
      // Include metadata entries (custom-title, tag, etc.) but don't track them in chain
      continue
    }

    // Remap UUID upfront
    const newUuid = randomUUID() as UUID
    uuidMap.set(entry.uuid, newUuid)

    mainEntries.push(entry)

    if (options?.upToMessageId && entry.uuid === options.upToMessageId) {
      hitUpTo = true
      break
    }
  }

  if (mainEntries.length === 0) {
    throw new Error(`No conversational messages to fork in session: ${sessionId}`)
  }

  if (options?.upToMessageId && !hitUpTo) {
    throw new Error(
      `upToMessageId ${options.upToMessageId} not found in session ${sessionId}`,
    )
  }

  // Build forked entries with remapped UUIDs
  const lines: string[] = []
  let parentUuid: UUID | null = null

  for (const entry of mainEntries) {
    const oldUuid = entry.uuid!
    const newUuid = uuidMap.get(oldUuid)!
    const oldParent = entry.parentUuid ?? null
    const newParent = oldParent ? (uuidMap.get(oldParent) ?? null) : null

    const forkedEntry: JsonlEntry & {
      sessionId: string
      forkedFrom: { sessionId: string; messageUuid: string }
    } = {
      ...entry,
      uuid: newUuid,
      parentUuid: newParent,
      sessionId: forkSessionId,
      isSidechain: false,
      forkedFrom: {
        sessionId,
        messageUuid: oldUuid,
      },
    }

    lines.push(JSON.stringify(forkedEntry))
    parentUuid = newUuid
  }

  // Write fork session file
  await writeFile(forkPath, lines.join('\n') + '\n', {
    encoding: 'utf8',
    mode: 0o600,
  })

  // Apply title if provided
  if (options?.title) {
    await appendJsonlEntry(forkPath, {
      type: 'custom-title',
      customTitle: options.title,
      sessionId: forkSessionId,
    })
  }

  return { session_id: forkSessionId }
}

// ============================================================================
// query() types
// ============================================================================

/**
 * Permission mode for the query.
 * Controls how tool permissions are handled.
 */
export type QueryPermissionMode =
  | 'default'
  | 'plan'
  | 'auto-accept'
  | 'bypass-permissions'
  | 'bypassPermissions'
  | 'acceptEdits'

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
   */
  canUseTool?: (
    name: string,
    input: unknown,
    options?: { toolUseID?: string },
  ) => Promise<{ behavior: 'allow' | 'deny'; message?: string; updatedInput?: unknown }>
  /**
   * Callback invoked when a tool needs permission approval. The host receives
   * the request immediately and can resolve it by calling
   * `query.respondToPermission(toolUseId, decision)` before the 30s timeout.
   * If omitted, tools that require permission fall through to the default
   * permission logic immediately (no timeout).
   */
  onPermissionRequest?: (message: SDKPermissionRequestMessage) => void
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
  /** Callback for stderr output. */
  stderr?: (data: string) => void
}

/**
 * A Query object represents an active conversation with the agent.
 * It implements AsyncIterable<SDKMessage> so you can use `for await` loops.
 */
export interface Query {
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
// Internal: canUseTool with external permission resolution support
// ============================================================================

type PermissionResolveDecision =
  | { behavior: 'allow'; updatedInput?: any }
  | { behavior: 'deny'; message: string; decisionReason: { type: 'mode'; mode: string } }

/**
 * Permission request message emitted when a tool needs permission approval.
 * Hosts can respond via respondToPermission() using the request_id.
 */
export type SDKPermissionRequestMessage = {
  type: 'permission_request'
  request_id: string
  tool_name: string
  tool_use_id: string
  input: Record<string, unknown>
  session_id?: string
}

/**
 * Creates a canUseTool function that supports external permission resolution
 * via respondToPermission().
 *
 * When a user-provided canUseTool callback exists, it takes priority.
 * Otherwise, a permission_request message is emitted to the SDK stream,
 * and the host can resolve it via respondToPermission() before the timeout.
 *
 * The flow:
 * 1. QueryEngine calls canUseTool(tool, input, ..., toolUseID, forceDecision)
 * 2. If forceDecision is set, honor it immediately
 * 3. If user canUseTool callback exists, delegate to it
 * 4. Otherwise, emit permission_request message and await external resolution
 *
 * For async external resolution, hosts should listen for permission_request
 * SDKMessages and call respondToPermission(). The pending prompt is registered
 * via registerPendingPermission() and awaited here.
 */
function createExternalCanUseTool(
  userFn: QueryOptions['canUseTool'],
  fallback: CanUseToolFn,
  permissionTarget: {
    registerPendingPermission(toolUseId: string): Promise<PermissionResolveDecision>
    pendingPermissionPrompts: Map<string, { resolve: (decision: PermissionResolveDecision) => void }>
  },
  onPermissionRequest?: (message: SDKPermissionRequestMessage) => void,
): CanUseToolFn {
  return async (tool, input, toolUseContext, assistantMessage, toolUseID, forceDecision) => {
    // If a forced decision was passed in, honor it
    if (forceDecision) return forceDecision

    // If the user provided a synchronous canUseTool callback, use it
    if (userFn) {
      try {
        const result = await userFn(tool.name, input, { toolUseID })
        if (result.behavior === 'allow') {
          return { behavior: 'allow' as const, updatedInput: result.updatedInput ?? input }
        }
        return {
          behavior: 'deny' as const,
          message: result.message ?? `Tool ${tool.name} denied by canUseTool callback`,
          decisionReason: { type: 'mode' as const, mode: 'default' },
        }
      } catch {
        return {
          behavior: 'deny' as const,
          message: `Tool ${tool.name} denied (callback error)`,
          decisionReason: { type: 'mode' as const, mode: 'default' },
        }
      }
    }

    // No user callback — if host registered an onPermissionRequest callback,
    // call it directly and await external resolution with timeout.
    if (toolUseID && onPermissionRequest) {
      const requestId = randomUUID()

      onPermissionRequest({
        type: 'permission_request',
        request_id: requestId,
        tool_name: tool.name,
        tool_use_id: toolUseID,
        input: input as Record<string, unknown>,
      })

      const pendingPromise = permissionTarget.registerPendingPermission(toolUseID)
      const timeoutMs = 30000

      let timeoutId: ReturnType<typeof setTimeout> | undefined
      const timeoutPromise = new Promise<{ timedOut: true }>(resolve => {
        timeoutId = setTimeout(() => resolve({ timedOut: true }), timeoutMs)
      })

      const raceResult = await Promise.race([
        pendingPromise.then(result => ({ result, timedOut: false })),
        timeoutPromise,
      ])

      if (timeoutId !== undefined) {
        clearTimeout(timeoutId)
      }

      if (!raceResult.timedOut && raceResult.result) {
        permissionTarget.pendingPermissionPrompts.delete(toolUseID)
        return raceResult.result
      }

      // Timeout — clean up
      const pending = permissionTarget.pendingPermissionPrompts.get(toolUseID)
      if (pending) {
        pending.resolve({ behavior: 'deny', message: 'Permission resolution timed out' })
        permissionTarget.pendingPermissionPrompts.delete(toolUseID)
      }
    }

    // No callback or no toolUseID — fall through to default permission logic
    return fallback(tool, input, toolUseContext, assistantMessage, toolUseID, forceDecision)
  }
}

// ============================================================================
// Internal: permission context from QueryOptions
// ============================================================================

function buildPermissionContext(options: QueryOptions): ToolPermissionContext {
  const base = getEmptyToolPermissionContext()
  const mode = options.permissionMode ?? 'default'

  // Map SDK permission mode to internal PermissionMode
  let internalMode: string = 'default'
  switch (mode) {
    case 'plan':
      internalMode = 'plan'
      break
    case 'auto-accept':
    case 'acceptEdits':
      internalMode = 'acceptEdits'
      break
    case 'bypass-permissions':
    case 'bypassPermissions':
      internalMode = 'bypassPermissions'
      break
    default:
      internalMode = 'default'
  }

  // Wire additionalDirectories into the permission context
  if (options.additionalDirectories && options.additionalDirectories.length > 0) {
    for (const dir of options.additionalDirectories) {
      base.additionalWorkingDirectories.set(dir, true)
    }
  }

  return {
    ...base,
    mode: internalMode as ToolPermissionContext['mode'],
    isBypassPermissionsModeAvailable:
      mode === 'bypass-permissions' || mode === 'bypassPermissions' || options.allowDangerouslySkipPermissions === true,
  }
}

// ============================================================================
// Internal: MCP server connection for SDK
// ============================================================================

/**
 * Connects to MCP servers from SDK options.
 * Takes the mcpServers config and connects to each server,
 * returning connected clients and their tools.
 *
 * @param mcpServers - MCP server configurations from SDK options
 * @returns Connected clients and their tools
 */
async function connectSdkMcpServers(
  mcpServers: Record<string, unknown> | undefined,
): Promise<{ clients: MCPServerConnection[]; tools: Tool[] }> {
  if (!mcpServers || Object.keys(mcpServers).length === 0) {
    return { clients: [], tools: [] }
  }

  const clients: MCPServerConnection[] = []
  const tools: Tool[] = []

  // Connect to each server in parallel
  const results = await Promise.allSettled(
    Object.entries(mcpServers).map(async ([name, config]) => {
      // Convert SDK config to ScopedMcpServerConfig format
      const scopedConfig: ScopedMcpServerConfig = {
        ...(config as Record<string, unknown>),
        scope: 'session' as const, // SDK servers are scoped to session
      }

      try {
        // Connect to the server
        const client = await connectToServer(name, scopedConfig, {
          totalServers: Object.keys(mcpServers).length,
          stdioCount: 0,
          sseCount: 0,
          httpCount: 0,
          sseIdeCount: 0,
          wsIdeCount: 0,
        })

        // If connected, fetch tools
        if (client.type === 'connected') {
          const serverTools = await fetchToolsForClient(client)
          return { client, tools: serverTools }
        }

        // Return failed/pending client with no tools
        return { client, tools: [] }
      } catch (error) {
        // Connection failed, return failed client
        return {
          client: {
            type: 'failed' as const,
            name,
            config: scopedConfig,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
          tools: [],
        }
      }
    }),
  )

  // Process results
  for (const result of results) {
    if (result.status === 'fulfilled') {
      clients.push(result.value.client)
      tools.push(...result.value.tools)
    }
  }

  return { clients, tools }
}

// ============================================================================
// Internal: permission-denying canUseTool for non-interactive use
// ============================================================================

/**
 * Default canUseTool that allows all tool uses. Permission filtering is
 * already handled at the tool-list level by getTools(permissionContext),
 * and bypass-permissions mode is reflected in the permission context itself.
 */
function createDefaultCanUseTool(
  _permissionContext: ToolPermissionContext,
): CanUseToolFn {
  // Return a simple implementation that allows all tool uses.
  // Permission filtering is already done at the tool-list level by
  // getTools(permissionContext), and the bypass-permissions mode is
  // reflected in the permission context itself.
  return async (_tool, input, _toolUseContext, _assistantMessage, _toolUseID, forceDecision) => {
    if (forceDecision) return forceDecision
    return { behavior: 'allow' as const, updatedInput: input }
  }
}

/**
 * Load a session's conversation messages from its JSONL file and inject
 * them into the QueryEngine so the conversation resumes from that history.
 * Returns true if messages were loaded, false if the session file was not found.
 */
async function loadAndInjectSessionMessages(
  sessionId: string,
  cwd: string,
  engine: QueryEngine,
  upToUuid?: string,
): Promise<boolean> {
  const resolved = await resolveSessionFilePath(sessionId, cwd)
  if (!resolved) return false

  const entries = await readJSONLFile<JsonlEntry>(resolved.filePath)
  let messages: unknown[] = entries
    .filter(entry => !entry.isSidechain && (entry.type === 'user' || entry.type === 'assistant'))
    .map(entry => ({ ...entry }))

  // If upToUuid is specified, walk the parentUuid chain from that UUID backwards
  // and only include messages in the chain (rollback/resumeSessionAt support)
  if (upToUuid && messages.length > 0) {
    const byUuid = new Map<string, (typeof messages)[0] & { parentUuid?: string | null; uuid?: string }>()
    for (const msg of messages) {
      const m = msg as typeof byUuid extends Map<string, infer V> ? V : never
      if (m.uuid) byUuid.set(m.uuid, m)
    }

    const target = byUuid.get(upToUuid)
    if (!target) {
      // UUID not found — throw error like forkSession does
      throw new Error(
        `resumeSessionAt ${upToUuid} not found in session ${sessionId}`
      )
    }
    // Walk chain from target backwards
    const chainSet = new Set<string>()
    let current: typeof target | undefined = target
    while (current) {
      if (!current.uuid || chainSet.has(current.uuid)) break
      chainSet.add(current.uuid)
      const parentRef: string | null | undefined = current.parentUuid
      current = parentRef ? byUuid.get(parentRef) : undefined
    }
    messages = messages.filter(msg => {
      const m = msg as { uuid?: string }
      return m.uuid && chainSet.has(m.uuid)
    })
  }

  if (messages.length > 0) {
    engine.injectMessages(messages as Parameters<QueryEngine['injectMessages']>[0])
  }
  return true
}

// ============================================================================
// QueryImpl — the concrete Query class
// ============================================================================

class QueryImpl implements Query {
  private engine: QueryEngine
  private prompt: string | AsyncIterable<SDKUserMessage>
  private abortController: AbortController
  private appStateStore: Store<AppState>
  private pendingPermissionPrompts = new Map<string, {
    resolve: (decision: PermissionResolveDecision) => void
  }>()
  private envOverrides: Record<string, string | undefined> | undefined
  private envSnapshot: Record<string, string | undefined> | undefined
  private sessionId?: string
  private shouldFork?: boolean
  private continueSession?: boolean
  private cwd: string
  private resumeSessionAt?: string
  private userAgents?: QueryOptions['agents']
  private mcpServers?: Record<string, unknown>
  private permissionContext: ToolPermissionContext

  constructor(
    engine: QueryEngine,
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
    this.engine = engine
    this.prompt = prompt
    this.abortController = abortController
    this.appStateStore = appStateStore
    this.envOverrides = envOverrides
    this.sessionId = sessionId
    this.shouldFork = fork
    this.continueSession = continueSession
    this.cwd = cwd
    this.resumeSessionAt = resumeSessionAt
    this.userAgents = userAgents
    this.mcpServers = mcpServers
    this.permissionContext = permissionContext
  }

  /** Late-bind the engine (used by query() which creates QueryImpl before the engine). */
  setEngine(engine: QueryEngine): void {
    this.engine = engine
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

  async *[Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    // Acquire cwd mutex for the entire query lifetime to prevent concurrent
    // sessions from corrupting each other's working directory.
    await acquireCwdMutex()
    const savedCwd = getCwdState()
    const savedOriginalCwd = getOriginalCwd()
    setCwd(this.cwd)
    setOriginalCwd(this.cwd)

    try {
      // Ensure init() completes before any query runs
      // init() applies config env vars, so we apply our overrides AFTER
      await init()

      // Load agent definitions BEFORE creating engine context
      // QueryEngine uses config.agents for toolUseContext.options.agentDefinitions
      let agentDefs: { activeAgents: any[]; allAgents: any[] } = { activeAgents: [], allAgents: [] }
      try {
        agentDefs = await getAgentDefinitionsWithOverrides(this.cwd)
      } catch {
        // Agent loading failed — continue without agents
      }

      // Update AppState with agents (for UI/SDK methods like supportedAgents())
      this.appStateStore.setState(prev => ({
        ...prev,
        agentDefinitions: agentDefs,
      }))

      // Inject agents into the engine so AgentTool can use them
      // QueryEngine's submitMessage reads from config.agents for toolUseContext
      // Merge user-provided agents (from options.agents) with disk-loaded agents
      if (this.userAgents && Object.keys(this.userAgents).length > 0) {
        const userAgents = Object.entries(this.userAgents).map(([name, def]) => ({
          name,
          ...def,
        }))
        agentDefs.activeAgents.push(...userAgents)
      }
      if (agentDefs.activeAgents.length > 0) {
        this.engine.injectAgents(agentDefs.activeAgents)
      }

      // Apply env overrides AFTER init() so they override config file env vars
      // Use mutex to ensure safe parallel query execution
      if (this.envOverrides && Object.keys(this.envOverrides).length > 0) {
        await acquireEnvMutex()
        try {
          // Snapshot existing values for keys we'll override
          this.envSnapshot = {}
          for (const key of Object.keys(this.envOverrides)) {
            this.envSnapshot[key] = process.env[key]
          }
          // Apply overrides - undefined means explicit unset
          for (const [key, value] of Object.entries(this.envOverrides)) {
            if (value === undefined) {
              delete process.env[key]
            } else {
              process.env[key] = value
            }
          }
        } finally {
          releaseEnvMutex()
        }
      }

      // Connect MCP servers if provided
      // This must happen before session loading so MCP tools are available
      if (this.mcpServers && Object.keys(this.mcpServers).length > 0) {
        const { clients: mcpClients, tools: mcpTools } = await connectSdkMcpServers(this.mcpServers)
        // Update engine config with MCP clients and merge tools
        if (mcpClients.length > 0) {
          this.engine.config.mcpClients = mcpClients
          // Merge MCP tools with existing tools
          const allTools = getTools(this.permissionContext)
          for (const mcpTool of mcpTools) {
            if (!allTools.some(t => t.name === mcpTool.name)) {
              allTools.push(mcpTool)
            }
          }
          this.engine.updateTools(allTools)
        }
      }

      // Handle continue: if continue=true and no sessionId, find last session for cwd
      let effectiveSessionId = this.sessionId

      if (this.continueSession && !this.sessionId) {
        const sessions = await listSessions({ dir: this.cwd, limit: 1 })
        if (sessions.length > 0) {
          effectiveSessionId = sessions[0].session_id
          // Load the session's messages into the engine so conversation resumes
          const loaded = await loadAndInjectSessionMessages(effectiveSessionId, this.cwd, this.engine, this.resumeSessionAt)
          if (!loaded) {
            effectiveSessionId = undefined
          }
        }
      } else if (this.shouldFork && this.sessionId) {
        // Handle fork: if sessionId and fork=true (or forkSession=true), fork the session first
        // If the session file doesn't exist (e.g., first query didn't persist),
        // just start a new session instead of throwing an error
        try {
          const forkResult = await forkSession(this.sessionId, { dir: this.cwd })
          effectiveSessionId = forkResult.session_id

          // Load the forked session's messages and inject them into the engine
          const loaded = await loadAndInjectSessionMessages(effectiveSessionId, this.cwd, this.engine, this.resumeSessionAt)
          if (!loaded) {
            effectiveSessionId = undefined
          }
        } catch {
          // Session not found or other fork error - just start fresh
          effectiveSessionId = undefined
        }
      } else if (this.sessionId) {
        // Simple resume: sessionId set without fork/continue — load messages directly
        // Supports rollback via resumeSessionAt (parentUuid chain walking)
        const loaded = await loadAndInjectSessionMessages(this.sessionId, this.cwd, this.engine, this.resumeSessionAt)
        if (!loaded) {
          effectiveSessionId = undefined
        }
      }

      // CRITICAL: Switch global session state before submitting to engine
      // This ensures messages emit correct session_id and transcript writes to correct file
      if (effectiveSessionId) {
        switchSession(effectiveSessionId, this.cwd)
      } else {
        // Fresh query — allocate a new session to avoid colliding with
        // other concurrent queries in the same process
        regenerateSessionId()
        switchSession(getSessionId(), this.cwd)
      }

      if (typeof this.prompt === 'string') {
        for await (const engineMsg of this.engine.submitMessage(this.prompt)) {
          yield engineMsg
        }
      } else {
        for await (const userMessage of this.prompt) {
          if (this.abortController.signal.aborted) break
          const content = extractPromptFromUserMessage(userMessage)
          for await (const engineMsg of this.engine.submitMessage(content, { uuid: userMessage.uuid })) {
            yield engineMsg
          }
        }
      }
    } finally {
      // Restore environment variables to snapshot state (with mutex for safety)
      if (this.envSnapshot) {
        await acquireEnvMutex()
        try {
          for (const key of Object.keys(this.envSnapshot)) {
            const originalValue = this.envSnapshot[key]
            if (originalValue === undefined) {
              delete process.env[key]
            } else {
              process.env[key] = originalValue
            }
          }
        } finally {
          releaseEnvMutex()
        }
      }

      // Restore cwd state and release mutex
      setCwdState(savedCwd)
      setOriginalCwd(savedOriginalCwd)
      releaseCwdMutex()
    }
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
    } as QueryOptions)
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
    this.abortController.abort()
  }

  interrupt(): void {
    this.engine.interrupt()
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
    return (state as any).commands?.map((c: any) => c.name ?? c) ?? []
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
    const agents = (state as any).agentDefinitions?.activeAgents
    return agents?.map((a: any) => a.name).filter(Boolean) ?? []
  }

  mcpServerStatus(): McpServerStatus[] {
    const state = this.appStateStore.getState()
    const clients: MCPServerConnection[] = state.mcp?.clients ?? []
    const allTools = state.mcp?.tools ?? []
    return clients.map((client): McpServerStatus => {
      const base: McpServerStatus = {
        name: client.name,
        status: client.type,
      }
      if (client.type === 'connected') {
        base.serverInfo = client.serverInfo
        // Tools are stored in state.mcp.tools (flat array), not on individual clients.
        // Use filterToolsByServer to get tools belonging to this server.
        const serverTools = filterToolsByServer(allTools, client.name)
        base.tools = serverTools.map(t => ({
          name: t.name,
          description: t.description,
          annotations: t.annotations,
        }))
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
      const { getAccountInformation, getAnthropicApiKeyWithSource } = await import('../utils/auth.js')
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
  const queryImpl = new QueryImpl(null as any, prompt, ac, appStateStore, envOverrides, effectiveSessionId, shouldFork, options.continue, cwd, options.resumeSessionAt, options.agents, options.mcpServers, permissionContext)

  // Build the canUseTool that supports external permission resolution.
  // When no user canUseTool callback is provided, this creates a pending
  // prompt entry that respondToPermission() can resolve asynchronously.
  const externalCanUseTool = createExternalCanUseTool(
    options.canUseTool,
    defaultCanUseTool,
    queryImpl,
    options.onPermissionRequest,
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
   */
  canUseTool?: (name: string, input: unknown, options?: { toolUseID?: string }) => Promise<{ behavior: 'allow' | 'deny'; message?: string; updatedInput?: unknown }>
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
  private engine: QueryEngine
  private _sessionId: string
  private options: SDKSessionOptions
  private appStateStore: Store<AppState>
  private agentsLoaded = false
  private mcpServers?: Record<string, unknown>
  private mcpConnected = false
  private pendingPermissionPrompts = new Map<string, {
    resolve: (decision: PermissionResolveDecision) => void
  }>()

  constructor(
    engine: QueryEngine,
    sessionId: string,
    options: SDKSessionOptions,
    appStateStore: Store<AppState>,
  ) {
    this.engine = engine
    this._sessionId = sessionId
    this.options = options
    this.appStateStore = appStateStore
    this.mcpServers = options.mcpServers
  }

  /** Late-bind the engine (used when session is created before engine). */
  setEngine(engine: QueryEngine): void {
    this.engine = engine
  }

  /** Late-bind the app state store (used when session is created before store). */
  setAppStateStore(store: Store<AppState>): void {
    this.appStateStore = store
  }

  get sessionId(): string {
    return this._sessionId
  }

  async *sendMessage(content: string): AsyncIterable<SDKMessage> {
    // Acquire cwd mutex for the duration of this message to prevent
    // concurrent sessions from overwriting each other's cwd.
    await acquireCwdMutex()
    const savedCwd = getCwdState()
    const savedOriginalCwd = getOriginalCwd()
    setCwd(this.options.cwd)
    setOriginalCwd(this.options.cwd)

    try {
      await init()

      // Load agent definitions once (not on every sendMessage call)
      if (!this.agentsLoaded) {
        try {
          const agentDefs = await getAgentDefinitionsWithOverrides(this.options.cwd)
          this.appStateStore.setState(prev => ({
            ...prev,
            agentDefinitions: agentDefs,
          }))
          if (agentDefs.activeAgents.length > 0) {
            this.engine.injectAgents(agentDefs.activeAgents)
          }
        } catch {
          // Agent loading failed — continue without agents
        }
        this.agentsLoaded = true
      }

      // Connect MCP servers once (lazy, on first message)
      if (!this.mcpConnected && this.mcpServers && Object.keys(this.mcpServers).length > 0) {
        const { clients: mcpClients, tools: mcpTools } = await connectSdkMcpServers(this.mcpServers)
        if (mcpClients.length > 0) {
          this.engine.config.mcpClients = mcpClients
          const permissionContext = (this.appStateStore.getState() as any).toolPermissionContext as ToolPermissionContext
          const allTools = getTools(permissionContext)
          for (const mcpTool of mcpTools) {
            if (!allTools.some(t => t.name === mcpTool.name)) {
              allTools.push(mcpTool)
            }
          }
          this.engine.updateTools(allTools)
        }
        this.mcpConnected = true
      }

      // CRITICAL: Switch global session state before submitting to engine
      // This ensures messages emit correct session_id and transcript writes to correct file
      const projectDir = getSessionProjectDir() || getOriginalCwd()
      switchSession(this._sessionId, projectDir)

      for await (const engineMsg of this.engine.submitMessage(content)) {
        yield engineMsg
      }
    } finally {
      // Restore cwd and release mutex
      setCwdState(savedCwd)
      setOriginalCwd(savedOriginalCwd)
      releaseCwdMutex()
    }
  }

  getMessages(): SDKMessage[] {
    return this.engine.getMessages().map(msg => mapMessageToSDK(msg as Record<string, unknown>))
  }

  interrupt(): void {
    this.engine.interrupt()
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
// Internal: create a QueryEngine from SDKSessionOptions
// ============================================================================

/**
 * Shared helper that builds a QueryEngine and its supporting state from
 * SDKSessionOptions. Used by both createSession and resumeSession.
 */
function createEngineFromOptions(
  options: SDKSessionOptions,
  permissionTarget: { registerPendingPermission(toolUseId: string): Promise<PermissionResolveDecision>; pendingPermissionPrompts: Map<string, { resolve: (decision: PermissionResolveDecision) => void }> },
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
  } as QueryOptions)

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
  const session = new SDKSessionImpl(null as any, sessionId, options, null as any)
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

  const session = new SDKSessionImpl(null as any, sessionId, options, null as any)
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

// ============================================================================
// tool() — factory function for creating MCP tool definitions
// ============================================================================

/**
 * Create a tool definition that can be passed to `createSdkMcpServer()`.
 *
 * @param name - Tool name (must be unique within the server)
 * @param description - Human-readable description of what the tool does
 * @param inputSchema - Zod raw shape or JSON Schema describing the input
 * @param handler - Async function that handles tool invocations
 * @param extras - Optional annotations, search hint, and alwaysLoad flag
 *
 * @example
 * ```typescript
 * const myTool = tool(
 *   'read_file',
 *   'Read a file from disk',
 *   { path: z.string() },
 *   async (args) => ({
 *     content: [{ type: 'text', text: await fs.readFile(args.path, 'utf8') }],
 *   }),
 * )
 * ```
 */
export function tool<Schema = any>(
  name: string,
  description: string,
  inputSchema: Schema,
  handler: (args: any, extra: unknown) => Promise<CallToolResult>,
  extras?: {
    annotations?: ToolAnnotations
    searchHint?: string
    alwaysLoad?: boolean
  },
): SdkMcpToolDefinition<Schema> {
  return {
    name,
    description,
    inputSchema,
    handler,
    annotations: extras?.annotations,
    searchHint: extras?.searchHint,
    alwaysLoad: extras?.alwaysLoad,
  }
}

// ============================================================================
// createSdkMcpServer() — stub that returns a config object
// ============================================================================

/**
 * Wraps an MCP server configuration for use with the SDK.
 * Adds the 'session' scope marker so the SDK knows this server
 * should be connected per-session (not globally).
 *
 * The `config` parameter must be a valid MCP server config with a
 * transport type and its required fields:
 * - stdio: `{ type: 'stdio', command: '...', args: [...] }`
 * - sse:   `{ type: 'sse', url: '...' }`
 * - http:  `{ type: 'http', url: '...' }`
 *
 * @example
 * ```typescript
 * const server = createSdkMcpServer({
 *   type: 'stdio',
 *   command: 'npx',
 *   args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
 * })
 * const session = unstable_v2_createSession({
 *   cwd: '/my/project',
 *   mcpServers: { 'fs': server },
 * })
 * ```
 */
export function createSdkMcpServer(config: Omit<ScopedMcpServerConfig, 'scope'>): ScopedMcpServerConfig {
  return {
    ...config,
    scope: 'session' as const,
  }
}

// ============================================================================
// Re-exports — error classes and helpers
// ============================================================================

export {
  AbortError,
  ClaudeError,
  SDKAuthenticationError,
  SDKBillingError,
  SDKRateLimitError,
  SDKInvalidRequestError,
  SDKServerError,
  SDKMaxOutputTokensError,
  sdkErrorFromType,
} from '../utils/errors.js'

export type { SDKAssistantMessageError } from '../utils/errors.js'

export type {
  RewindFilesResult,
  McpServerStatus,
  ApiKeySource,
  PermissionResult,
} from './sdk/coreTypes.generated.js'
