import type { BetaTool } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'

// Session-scoped cache of rendered tool schemas. Tool schemas render at server
// position 2 (before system prompt), so any byte-level change busts the entire
// ~11K-token tool block AND everything downstream. GrowthBook gate flips
// (tengu_tool_pear, tengu_fgts), MCP reconnects, or dynamic content in
// tool.prompt() all cause this churn. Memoizing per-session locks the schema
// bytes at first render — mid-session GB refreshes no longer bust the cache.
//
// Lives in a leaf module so auth.ts can clear it without importing api.ts
// (which would create a cycle via plans→settings→file→growthbook→config→
// bridgeEnabled→auth).
type CachedSchema = BetaTool & {
  strict?: boolean
  eager_input_streaming?: boolean
}

const TOOL_SCHEMA_CACHE = new Map<string, CachedSchema>()

export function getToolSchemaCache(): Map<string, CachedSchema> {
  return TOOL_SCHEMA_CACHE
}

export function clearToolSchemaCache(): void {
  TOOL_SCHEMA_CACHE.clear()
}

/**
 * Selectively invalidate cache entries for tools not in the provided set.
 * Used by QueryEngine.updateTools() to avoid clearing schemas for tools that
 * remain unchanged across concurrent engines in multi-session SDK scenarios.
 *
 * @param retainedToolNames - Set of tool names that should keep their cache entries
 */
export function invalidateRemovedToolSchemas(retainedToolNames: Set<string>): void {
  for (const key of TOOL_SCHEMA_CACHE.keys()) {
    // Cache key format: either "toolName" or "toolName:{...schemaJSON...}"
    // Extract the tool name portion (before the colon if present)
    const toolName = key.includes(':') ? key.split(':')[0] : key
    if (!retainedToolNames.has(toolName)) {
      TOOL_SCHEMA_CACHE.delete(key)
    }
  }
}
