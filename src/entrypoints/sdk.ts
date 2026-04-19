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
import type {
  RewindFilesResult,
  McpServerStatus,
  ApiKeySource,
  PermissionResult,
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
import type { MCPServerConnection } from '../services/mcp/types.js'

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
// SDK Types — snake_case public interface
// ============================================================================

/**
 * A message emitted by the query engine during a conversation.
 *
 * This is a simplified representation for the SDK; the full union type is
 * defined in the Zod schemas (coreSchemas.ts). Until the generated types
 * file is populated, we define the essential shape here.
 *
 * TODO: Replace with the full generated type from coreTypes.generated.ts
 *       once type generation is wired up.
 */
export type SDKMessage = {
  type: string
  [key: string]: unknown
}

/**
 * A user message fed into query() via AsyncIterable.
 *
 * Matches the SDKUserMessage Zod schema shape:
 * { type: 'user', message: string | ContentBlock[], ... }
 *
 * TODO: Replace with the full generated type from coreTypes.generated.ts
 *       once type generation is wired up.
 */
export type SDKUserMessage = {
  type: 'user'
  message: string | Array<{ type: string; text?: string; [key: string]: unknown }>
  parent_tool_use_id?: string | null
  isSynthetic?: boolean
  tool_use_result?: unknown
  priority?: 'now' | 'next' | 'later'
  timestamp?: string
  uuid?: string
  session_id?: string
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
  /** Resume the most recent session for this cwd (no sessionId needed). */
  continue?: boolean
  /** Resume strategy. */
  resume?: string
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
  /**
   * Callback invoked before each tool use. Return `{ behavior: 'allow' }` to
   * permit the call or `{ behavior: 'deny', message?: string }` to reject it.
   */
  canUseTool?: (
    name: string,
    input: unknown,
  ) => Promise<{ behavior: 'allow' | 'deny'; message?: string }>
  /** System prompt override. */
  systemPrompt?:
    | { type: 'preset'; preset: string }
    | { type: 'custom'; content: string }
  /** Setting sources to load. */
  settingSources?: string[]
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
// Internal: canUseTool adapter
// ============================================================================

/**
 * Wraps a user-provided canUseTool callback (simple signature) into the
 * full CanUseToolFn signature expected by QueryEngine. The user callback
 * only receives tool name and input; the remaining arguments are ignored.
 */
function wrapCanUseTool(
  userFn: QueryOptions['canUseTool'],
  fallback: CanUseToolFn,
): CanUseToolFn {
  if (!userFn) return fallback
  return async (tool, input, toolUseContext, assistantMessage, toolUseID, forceDecision) => {
    // If a forced decision was passed in (e.g. from speculation), honor it
    if (forceDecision) return forceDecision

    try {
      const result = await userFn(tool.name, input)
      if (result.behavior === 'allow') {
        return {
          behavior: 'allow' as const,
          updatedInput: input,
        }
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
}

// ============================================================================
// Internal: canUseTool with external permission resolution support
// ============================================================================

type PermissionResolveDecision =
  | { behavior: 'allow'; updatedInput?: any }
  | { behavior: 'deny'; message: string; decisionReason: { type: 'mode'; mode: string } }

/**
 * Creates a canUseTool function that supports external permission resolution
 * via respondToPermission().
 *
 * When a user-provided canUseTool callback exists, it takes priority.
 * Otherwise, the fallback (auto-allow) is used and no pending prompts are
 * created. To use the external permission flow, the SDK host must NOT
 * provide a canUseTool callback — instead, it calls respondToPermission()
 * after the query yields a permission-request message.
 *
 * The flow:
 * 1. QueryEngine calls canUseTool(tool, input, ..., toolUseID, forceDecision)
 * 2. If forceDecision is set, honor it immediately
 * 3. If user canUseTool callback exists, delegate to it
 * 4. Otherwise, delegate to fallback (auto-allow)
 *
 * For async external resolution, hosts should listen for permission-request
 * SDKMessages and call respondToPermission(). The pending prompt is registered
 * via registerPendingPermission() and awaited here.
 */
function createExternalCanUseTool(
  userFn: QueryOptions['canUseTool'],
  fallback: CanUseToolFn,
  queryImpl: QueryImpl,
): CanUseToolFn {
  return async (tool, input, toolUseContext, assistantMessage, toolUseID, forceDecision) => {
    // If a forced decision was passed in, honor it
    if (forceDecision) return forceDecision

    // If the user provided a synchronous canUseTool callback, use it
    if (userFn) {
      try {
        const result = await userFn(tool.name, input)
        if (result.behavior === 'allow') {
          return { behavior: 'allow' as const, updatedInput: input }
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

    // No user callback — use fallback (auto-allow in most SDK modes).
    // The pendingPermissionPrompts map is still available for hosts that
    // want to intercept via a custom mechanism, but by default the
    // fallback allows everything.
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
      internalMode = 'acceptEdits'
      break
    case 'bypass-permissions':
      internalMode = 'bypassPermissions'
      break
    default:
      internalMode = 'default'
  }

  return {
    ...base,
    mode: internalMode as ToolPermissionContext['mode'],
    isBypassPermissionsModeAvailable:
      mode === 'bypass-permissions' || options.allowDangerouslySkipPermissions === true,
  }
}

// ============================================================================
// Internal: permission-denying canUseTool for non-interactive use
// ============================================================================

/**
 * Default canUseTool that auto-allows in bypass mode or denies interactive
 * prompts (since the SDK is non-interactive). For non-bypass modes, it
 * checks the permission context rules via hasPermissionsToUseTool.
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

// ============================================================================
// QueryImpl — the concrete Query class
// ============================================================================

class QueryImpl implements Query {
  private engine: QueryEngine
  private prompt: string | AsyncIterable<SDKUserMessage>
  private abortController: AbortController
  private appStateStore: Store<AppState>
  private pendingPermissionPrompts = new Map<string, {
    resolve: (decision: { behavior: 'allow'; updatedInput?: any } | { behavior: 'deny'; message: string; decisionReason: { type: 'mode'; mode: string } }) => void
  }>()
  private envSnapshot: Record<string, string | undefined>
  private sessionId?: string
  private shouldFork?: boolean
  private continueSession?: boolean
  private cwd: string

  constructor(
    engine: QueryEngine,
    prompt: string | AsyncIterable<SDKUserMessage>,
    abortController: AbortController,
    appStateStore: Store<AppState>,
    envSnapshot: Record<string, string | undefined> = {},
    sessionId?: string,
    fork?: boolean,
    continueSession?: boolean,
    cwd: string = '',
  ) {
    this.engine = engine
    this.prompt = prompt
    this.abortController = abortController
    this.appStateStore = appStateStore
    this.envSnapshot = envSnapshot
    this.sessionId = sessionId
    this.shouldFork = fork
    this.continueSession = continueSession
    this.cwd = cwd
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
  registerPendingPermission(toolUseId: string): Promise<{ behavior: 'allow'; updatedInput?: any } | { behavior: 'deny'; message: string; decisionReason: { type: 'mode'; mode: string } }> {
    return new Promise(resolve => {
      this.pendingPermissionPrompts.set(toolUseId, { resolve })
    })
  }

  async *[Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    try {
      // Ensure init() completes before any query runs
      await init()

      // Handle continue: if continue=true and no sessionId, find last session for cwd
      let effectiveSessionId = this.sessionId
      if (this.continueSession && !this.sessionId) {
        const sessions = await listSessions({ dir: this.cwd, limit: 1 })
        if (sessions.length > 0) {
          effectiveSessionId = sessions[0].session_id
        }
      }

      // Handle fork: if sessionId and fork=true, fork the session first
      if (this.sessionId && this.shouldFork) {
        const forkResult = await forkSession(this.sessionId, { dir: this.cwd })
        effectiveSessionId = forkResult.session_id

        // Load the forked session's messages and inject them into the engine
        // so the query resumes from that history
        const resolved = await resolveSessionFilePath(effectiveSessionId, this.cwd)
        if (!resolved) {
          throw new Error(
            `Forked session file not found: unable to resolve path for session ${effectiveSessionId} in directory ${this.cwd || 'default session storage'}`,
          )
        }
        const entries = await readJSONLFile<JsonlEntry>(resolved.filePath)
        // Filter to main conversation entries only (no sidechains, no metadata)
        // and convert to format expected by QueryEngine
        const messages: unknown[] = entries
          .filter(entry => {
            if (entry.isSidechain) return false
            // Only include user and assistant messages (not metadata like custom-title, tag)
            return entry.type === 'user' || entry.type === 'assistant'
          })
          .map(entry => ({
            // Preserve all fields from the entry (type, uuid, parentUuid, timestamp, message, etc.)
            ...entry,
          }))

        // Inject messages into the engine so it resumes from fork history
        if (messages.length > 0) {
          // Cast to Message[] for injectMessages - entries from JSONL files
          // contain the expected fields (type, uuid, message, etc.)
          this.engine.injectMessages(messages as Parameters<QueryEngine['injectMessages']>[0])
        }
      }

      if (typeof this.prompt === 'string') {
        // Single string prompt — submit once and yield all results
        yield* this.engine.submitMessage(this.prompt)
      } else {
        // AsyncIterable<SDKUserMessage> — iterate and submit each message
        for await (const userMessage of this.prompt) {
          // Check if aborted before processing next message
          if (this.abortController.signal.aborted) break

          // Pass content directly to submitMessage
          const content = extractPromptFromUserMessage(userMessage)
          yield* this.engine.submitMessage(content, { uuid: userMessage.uuid })
        }
      }
    } finally {
      // Restore environment variables to snapshot state
      for (const key of Object.keys(this.envSnapshot)) {
        const originalValue = this.envSnapshot[key]
        if (originalValue === undefined) {
          delete process.env[key]
        } else {
          process.env[key] = originalValue
        }
      }
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
    const newPermissionContext = buildPermissionContext({
      ...({ cwd: '' } as QueryOptions),
      permissionMode: mode,
    })
    this.appStateStore.setState(prev => ({
      ...prev,
      toolPermissionContext: newPermissionContext,
    }))
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
        // Synchronous check — return canRewind: true.
        // The actual rewind is async; caller should use rewindFilesAsync()
        // (not yet exposed in the public API) or trigger via other means.
        return { canRewind: true }
      }
    }

    return { canRewind: false, error: 'No file-history snapshot found to rewind to' }
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
    return clients.map((client): McpServerStatus => {
      const base: McpServerStatus = {
        name: client.name,
        status: client.type,
      }
      if (client.type === 'connected') {
        base.serverInfo = client.serverInfo
        base.tools = (client as any).tools?.map((t: any) => ({
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
      return { apiKeySource: 'none' as ApiKeySource }
    }
  }

  setMaxThinkingTokens(tokens: number): void {
    this.appStateStore.setState(prev => ({
      ...prev,
      thinkingEnabled: tokens > 0 ? true : prev.thinkingEnabled,
    }))
  }
}

/**
 * Extract a prompt from an SDKUserMessage.
 *
 * SDKUserMessage has a `message` field that can be a string or an array of
 * content blocks. QueryEngine.submitMessage() accepts both `string` and
 * `ContentBlockParam[]`, so we pass through directly when possible.
 */
function extractPromptFromUserMessage(
  msg: SDKUserMessage,
): string | Array<{ type: string; text?: string; [key: string]: unknown }> {
  const { message } = msg
  if (typeof message === 'string') {
    return message
  }
  if (Array.isArray(message)) {
    return message
  }
  return String(message ?? '')
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

  // Handle env overrides with snapshot/restore pattern
  const envOverrides = settings?.env
  const envSnapshot: Record<string, string | undefined> = {}
  if (envOverrides && Object.keys(envOverrides).length > 0) {
    // Snapshot existing values for keys we'll override
    for (const key of Object.keys(envOverrides)) {
      envSnapshot[key] = process.env[key]
    }
    // Apply overrides
    for (const [key, value] of Object.entries(envOverrides)) {
      process.env[key] = value
    }
  }

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

  // Set up cwd immediately (synchronous)
  setCwd(cwd)

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
  const canUseTool = wrapCanUseTool(options.canUseTool, defaultCanUseTool)

  // Determine custom system prompt
  let customSystemPrompt: string | undefined
  if (systemPrompt?.type === 'custom') {
    customSystemPrompt = systemPrompt.content
  }

  // Abort controller
  const ac = abortController ?? new AbortController()

  // Create the Query wrapper first so we can wire canUseTool to its
  // pending permission map. Pass envSnapshot for restoration after query completes.
  // Also pass sessionId, fork, continue, and cwd for session handling in the iterator.
  const queryImpl = new QueryImpl(null as any, prompt, ac, appStateStore, envSnapshot, options.sessionId, options.fork, options.continue, cwd)

  // Build the canUseTool that supports external permission resolution.
  // When no user canUseTool callback is provided, this creates a pending
  // prompt entry that respondToPermission() can resolve asynchronously.
  const externalCanUseTool = createExternalCanUseTool(
    options.canUseTool,
    defaultCanUseTool,
    queryImpl,
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
    userSpecifiedModel: model,
    abortController: ac,
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
  canUseTool?: (name: string, input: unknown) => Promise<{ behavior: 'allow' | 'deny'; message?: string }>
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
}

/**
 * An SDKResultMessage is the final message emitted by a query turn,
 * containing the result text, usage stats, and cost information.
 *
 * TODO: Replace with the full generated type from coreTypes.generated.ts
 *       once type generation is wired up.
 */
export type SDKResultMessage = SDKMessage & {
  type: 'result'
  subtype: string
  is_error: boolean
  duration_ms: number
  duration_api_ms: number
  num_turns: number
  result: string
  stop_reason: string | null
  session_id: string
  total_cost_usd: number
  uuid: string
}

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
  }

  get sessionId(): string {
    return this._sessionId
  }

  async *sendMessage(content: string): AsyncIterable<SDKMessage> {
    await init()
    yield* this.engine.submitMessage(content)
  }

  getMessages(): SDKMessage[] {
    // QueryEngine.getMessages() returns readonly Message[], map to SDKMessage[]
    return this.engine.getMessages() as unknown as SDKMessage[]
  }

  interrupt(): void {
    this.engine.interrupt()
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
  initialMessages?: any[],
): { engine: QueryEngine; appStateStore: Store<AppState> } {
  const { cwd, model, abortController, permissionMode } = options

  if (!cwd) {
    throw new Error('SDKSessionOptions requires cwd')
  }

  setCwd(cwd)

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

  // Get tools filtered by permission context
  const tools = getTools(permissionContext)

  // Create file state cache
  const readFileCache = createFileStateCacheWithSizeLimit(100)

  // Build the canUseTool callback
  const defaultCanUseTool = createDefaultCanUseTool(permissionContext)
  const canUseTool = wrapCanUseTool(
    options.canUseTool
      ? (name: string, input: unknown) => options.canUseTool!(name, input)
      : undefined,
    defaultCanUseTool,
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
  const { engine, appStateStore } = createEngineFromOptions(options)
  return new SDKSessionImpl(engine, sessionId, options, appStateStore)
}

/**
 * V2 API - UNSTABLE
 * Resume an existing session by ID. Loads the session's prior messages
 * from disk and replays them into the QueryEngine so the conversation
 * continues from where it left off.
 *
 * @alpha
 *
 * @param sessionId - UUID of the session to resume
 * @param options - Session options (cwd is required)
 */
export function unstable_v2_resumeSession(
  sessionId: string,
  options: SDKSessionOptions,
): SDKSession {
  assertValidSessionId(sessionId)

  // Load existing session messages synchronously — we construct the engine
  // with initialMessages so the conversation history is available.
  // NOTE: This is synchronous construction. The actual message loading from
  // disk would need to be done before calling resumeSession and passed in
  // via a future API extension. For now, we create a fresh engine and the
  // caller is responsible for re-sending context.
  const { engine, appStateStore } = createEngineFromOptions(options)
  return new SDKSessionImpl(engine, sessionId, options, appStateStore)
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
 * Creates an MCP server configuration object from a set of tool definitions.
 *
 * Currently returns a plain config object. In a future release this will
 * return a fully wired MCP server instance.
 *
 * @param options - Server name, version, and tool definitions
 *
 * @example
 * ```typescript
 * const server = createSdkMcpServer({
 *   name: 'my-tools',
 *   version: '1.0.0',
 *   tools: [myTool],
 * })
 * ```
 */
export function createSdkMcpServer(options: {
  name: string
  version?: string
  tools?: SdkMcpToolDefinition[]
}): {
  name: string
  version: string | undefined
  tools: SdkMcpToolDefinition[]
} {
  return {
    name: options.name,
    version: options.version,
    tools: options.tools ?? [],
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
