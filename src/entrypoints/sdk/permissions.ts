/**
 * Permission handling for the SDK.
 *
 * Provides canUseTool wrappers, permission context building,
 * MCP server connection, and default permission-denying logic.
 *
 * @internal — these utilities are not part of the public SDK API.
 */

import { randomUUID } from 'crypto'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import {
  getEmptyToolPermissionContext,
  type ToolPermissionContext,
  type Tool,
} from '../../Tool.js'
import type { MCPServerConnection, ScopedMcpServerConfig } from '../../services/mcp/types.js'
import { connectToServer, fetchToolsForClient } from '../../services/mcp/client.js'
import type {
  QueryPermissionMode,
  CanUseToolCallback,
  SDKPermissionRequestMessage,
  SDKPermissionTimeoutMessage,
} from './shared.js'

// ============================================================================
// Constants
// ============================================================================

/** Default timeout for permission prompts (30 seconds). Reasonable for human response time. */
export const DEFAULT_PERMISSION_TIMEOUT_MS = 30000

/**
 * Placeholder session_id for permission requests outside SDK session context.
 * Used when createExternalCanUseTool is called without a sessionId parameter,
 * indicating a standalone permission prompt (e.g., direct tool permission check
 * without an active SDK session). Hosts can identify such requests by checking
 * session_id === NO_SESSION_PLACEHOLDER.
 */
export const NO_SESSION_PLACEHOLDER = 'no-session'

// ============================================================================
// Logger interface for SDK surface
// ============================================================================

/**
 * Logger interface for SDK permission system.
 * Hosts can inject a custom logger to control warning output.
 * Defaults to console.warn if no logger is provided.
 */
export interface SDKLogger {
  warn(message: string): void
}

/** Default console-based logger used when no custom logger is provided. */
const defaultLogger: SDKLogger = {
  warn: (message: string) => console.warn(message),
}

// ============================================================================
// Once-only resolve wrapper
// ============================================================================

/**
 * Creates a resolve function that can only be called once.
 * Prevents promise twice-resolve race conditions when timeout
 * and host response happen simultaneously.
 */
export function createOnceOnlyResolve<T>(
  resolve: (value: T) => void,
): (value: T) => void {
  let resolved = false
  return (value: T) => {
    if (!resolved) {
      resolved = true
      resolve(value)
    }
  }
}

// ============================================================================
// Permission target factory (for race condition safety)
// ============================================================================

/**
 * Factory for creating a permissionTarget with proper race condition handling.
 * The once-only resolve wrapper is applied at registration time, ensuring
 * both timeout handler and host response use the same wrapped resolve.
 *
 * Usage:
 * ```typescript
 * const permissionTarget = createPermissionTarget()
 * const canUseTool = createExternalCanUseTool(
 *   undefined,
 *   fallback,
 *   permissionTarget,
 *   onPermissionRequest,
 *   onTimeout
 * )
 * ```
 */
export function createPermissionTarget() {
  const pendingPermissionPrompts = new Map<string, { resolve: (decision: PermissionResolveDecision) => void }>()

  const registerPendingPermission = (toolUseId: string): Promise<PermissionResolveDecision> => {
    return new Promise(resolve => {
      // Apply onceOnlyResolve at registration time - this ensures both
      // timeout handler and host response use the same wrapped resolve,
      // preventing "promise already resolved" errors
      const wrappedResolve = createOnceOnlyResolve(resolve)
      pendingPermissionPrompts.set(toolUseId, { resolve: wrappedResolve })
    })
  }

  return {
    registerPendingPermission,
    pendingPermissionPrompts,
  }
}

// ============================================================================
// Permission resolve decision type
// ============================================================================

export type PermissionResolveDecision =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown> }
  | { behavior: 'deny'; message: string; decisionReason: { type: 'mode'; mode: string } }

// ============================================================================
// buildPermissionContext
// ============================================================================

export interface PermissionContextOptions {
  cwd: string
  permissionMode?: QueryPermissionMode
  additionalDirectories?: string[]
  allowDangerouslySkipPermissions?: boolean
}

export function buildPermissionContext(options: PermissionContextOptions): ToolPermissionContext {
  const base = getEmptyToolPermissionContext()
  const mode = options.permissionMode ?? 'default'

  // Map SDK permission mode to internal PermissionMode
  let internalMode: string = 'default'
  switch (mode) {
    case 'plan':
      internalMode = 'plan'
      break
    case 'auto-accept': // Alias for acceptEdits
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
// createExternalCanUseTool
// ============================================================================

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
export function createExternalCanUseTool(
  userFn: CanUseToolCallback | undefined,
  fallback: CanUseToolFn,
  permissionTarget: {
    registerPendingPermission(toolUseId: string): Promise<PermissionResolveDecision>
    pendingPermissionPrompts: Map<string, { resolve: (decision: PermissionResolveDecision) => void }>
  },
  onPermissionRequest?: (message: SDKPermissionRequestMessage) => void,
  onTimeout?: (message: SDKPermissionTimeoutMessage) => void,
  // Default 30 second timeout for permission prompts - reasonable for human response time
  timeoutMs: number = DEFAULT_PERMISSION_TIMEOUT_MS,
  sessionId?: string,
  logger?: SDKLogger,
): CanUseToolFn {
  const log = logger ?? defaultLogger
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
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown callback error'
        return {
          behavior: 'deny' as const,
          message: `Tool ${tool.name} denied (callback error: ${errorMessage})`,
          decisionReason: { type: 'mode' as const, mode: 'default' },
        }
      }
    }

    // No user callback — if host registered an onPermissionRequest callback,
    // call it directly and await external resolution with timeout.
    if (toolUseID && onPermissionRequest) {
      const requestId = randomUUID()
      const messageUuid = randomUUID()

      // Register pending permission BEFORE emitting the request so that
      // a host which responds synchronously from onPermissionRequest can
      // find the entry in pendingPermissionPrompts immediately.
      const pendingPromise = permissionTarget.registerPendingPermission(toolUseID)

      // Wrap onPermissionRequest in try-catch since it's SDK-host-provided code.
      // If it throws, clean up the pending entry and deny/fallback cleanly.
      try {
        onPermissionRequest({
          type: 'permission_request',
          request_id: requestId,
          tool_name: tool.name,
          tool_use_id: toolUseID,
          input: input as Record<string, unknown>,
          uuid: messageUuid,
          session_id: sessionId ?? NO_SESSION_PLACEHOLDER,
        })
      } catch (err) {
        permissionTarget.pendingPermissionPrompts.delete(toolUseID)
        const errorMessage = err instanceof Error ? err.message : 'Unknown host callback error'
        return {
          behavior: 'deny' as const,
          message: `Tool ${tool.name} denied (onPermissionRequest callback error: ${errorMessage})`,
          decisionReason: { type: 'mode' as const, mode: 'default' },
        }
      }

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

      // Timeout — emit event and clean up
      if (onTimeout) {
        onTimeout({
          type: 'permission_timeout',
          tool_name: tool.name,
          tool_use_id: toolUseID,
          timed_out_after_ms: timeoutMs,
        })
      }
      log.warn(
        `[SDK] Permission request for tool "${tool.name}" timed out after ${timeoutMs}ms. ` +
        'Denying by default. Provide a canUseTool callback or respond to permission_request ' +
        'messages within the timeout window.',
      )
      const pending = permissionTarget.pendingPermissionPrompts.get(toolUseID)
      if (pending) {
        // Resolve the pending promise with denial.
        // NOTE: For race condition safety, use createPermissionTarget() which wraps
        // the resolve at registration time. If using a custom permissionTarget,
        // callers should apply createOnceOnlyResolve in their registerPendingPermission.
        pending.resolve({
          behavior: 'deny',
          message: `Permission resolution timed out for tool "${tool.name}"`,
        })
        permissionTarget.pendingPermissionPrompts.delete(toolUseID)
      }
    }

    // No callback or no toolUseID — fall through to default permission logic
    return fallback(tool, input, toolUseContext, assistantMessage, toolUseID, forceDecision)
  }
}

// ============================================================================
// MCP server connection for SDK
// ============================================================================

/**
 * Connects to MCP servers from SDK options.
 * Takes the mcpServers config and connects to each server,
 * returning connected clients and their tools.
 *
 * @param mcpServers - MCP server configurations from SDK options
 * @returns Connected clients and their tools
 */
export async function connectSdkMcpServers(
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
      // Validate config is a non-null object before spreading (arrays are objects but invalid for config)
      if (config === null || typeof config !== 'object' || Array.isArray(config)) {
        return {
          client: {
            type: 'failed' as const,
            name,
            config: { scope: 'session' as const } as ScopedMcpServerConfig,
            error: `Invalid MCP server config for '${name}': expected object, got ${config === null ? 'null' : Array.isArray(config) ? 'array' : typeof config}`,
          },
          tools: [],
        }
      }

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
        // Connection failed, return failed client with error message
        const errorMessage = error instanceof Error
          ? error.message
          : 'Unknown error'
        return {
          client: {
            type: 'failed' as const,
            name,
            config: scopedConfig,
            error: errorMessage,
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
// Default permission-denying canUseTool
// ============================================================================

let warnedDefaultPermissions = false

/**
 * Default canUseTool that DENIES all tool uses when no explicit
 * canUseTool or onPermissionRequest callback is provided.
 *
 * This is the secure-by-default behavior: SDK consumers must explicitly
 * provide a permission callback to allow tool execution. Permission modes
 * like 'bypass-permissions' still work because tool filtering happens at
 * the tool-list level via getTools(permissionContext) before this function
 * is ever reached.
 */
export function createDefaultCanUseTool(
  _permissionContext: ToolPermissionContext,
  logger?: SDKLogger,
): CanUseToolFn {
  const log = logger ?? defaultLogger
  if (!warnedDefaultPermissions) {
    warnedDefaultPermissions = true
    log.warn(
      '[SDK] No canUseTool or onPermissionRequest callback provided. ' +
      'All tool uses will be DENIED by default. ' +
      'Provide canUseTool in query options, e.g.: ' +
      '{ canUseTool: async (name, input) => ({ behavior: "allow" }) }',
    )
  }
  return async (tool, input, _toolUseContext, _assistantMessage, _toolUseID, forceDecision) => {
    if (forceDecision) return forceDecision
    return {
      behavior: 'deny' as const,
      message: `SDK: Tool "${tool.name}" denied — no canUseTool or onPermissionRequest callback provided. Pass canUseTool in options to control tool permissions.`,
      decisionReason: { type: 'mode' as const, mode: 'default' },
    }
  }
}
