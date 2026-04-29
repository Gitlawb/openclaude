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
// Permission resolve decision type
// ============================================================================

export type PermissionResolveDecision =
  | { behavior: 'allow'; updatedInput?: any }
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
  timeoutMs: number = 30000,
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

      onPermissionRequest({
        type: 'permission_request',
        request_id: requestId,
        tool_name: tool.name,
        tool_use_id: toolUseID,
        input: input as Record<string, unknown>,
      })

      const pendingPromise = permissionTarget.registerPendingPermission(toolUseID)

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
      console.warn(
        `[SDK] Permission request for tool "${tool.name}" timed out after ${timeoutMs}ms. ` +
        'Denying by default. Provide a canUseTool callback or respond to permission_request ' +
        'messages within the timeout window.',
      )
      const pending = permissionTarget.pendingPermissionPrompts.get(toolUseID)
      if (pending) {
        // Use once-only resolve wrapper to prevent double-resolve race condition
        // when timeout and host response happen simultaneously
        const onceOnlyResolve = createOnceOnlyResolve(pending.resolve)
        onceOnlyResolve({ behavior: 'deny', message: 'Permission resolution timed out' })
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
): CanUseToolFn {
  if (!warnedDefaultPermissions) {
    warnedDefaultPermissions = true
    console.warn(
      '[SDK] No canUseTool or onPermissionRequest callback provided. ' +
      'All tool uses will be DENIED by default. ' +
      'Provide canUseTool in query options to allow specific tools.',
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
