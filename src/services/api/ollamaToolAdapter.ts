/**
 * Ollama Tool Call Adapter
 *
 * Handles the case where local Ollama models (like qwen2.5-coder) don't properly
 * support tool calling and instead output JSON-formatted tool calls as text.
 *
 * This adapter detects such JSON output and converts it into proper tool_use blocks
 * that the rest of the system can process.
 *
 * Example problematic output from Ollama:
 * ```
 *   {
 *     "name": "Write",
 *     "arguments": {
 *       "file_path": "/path/to/file",
 *       "content": "..."
 *     }
 *   }
 * ```
 *
 * This gets converted to:
 * ```
 * {
 *   type: 'tool_use',
 *   id: '...',
 *   name: 'Write',
 *   input: { file_path: '/path/to/file', content: '...' }
 * }
 * ```
 */

import { logForDebugging } from '../../utils/debug.js'

/**
 * Pattern to match JSON tool call objects in model output.
 * Looks for objects with "name" and "arguments" fields.
 * More flexible to handle indentation and newlines.
 */
const TOOL_CALL_JSON_PATTERN = /[\s{]?"name"\s*:\s*"([^"]+)"\s*,\s*"arguments"\s*:\s*([\s\S]*?)(?=\s*,\s*"name"\s*:\s*|}$|\])\s*/g

/**
 * Pattern to match multiple tool calls in array or JSONL format.
 */
const TOOL_CALLS_ARRAY_PATTERN = /\[\s*\{[\s\S]*?"name"\s*:\s*"[^"]+"[\s\S]*?\}\s*(?:,\s*\{[\s\S]*?"name"\s*:\s*"[^"]+"[\s\S]*?\})*\s*\]/g

/**
 * Common tool names that might appear in JSON tool calls.
 */
const KNOWN_TOOLS = new Set([
  'Write',
  'Read',
  'Bash',
  'Edit',
  'Glob',
  'Grep',
  'Agent',
  'AskUserQuestion',
  'Skill',
  'mcp__',
])

/**
 * Check if the given text looks like a JSON-formatted tool call.
 */
export function looksLikeJsonToolCall(text: string): boolean {
  const trimmed = text.trim()

  // Must contain the characteristic name/arguments structure
  const hasNameField = /"name"\s*:\s*"[^"]+"/.test(trimmed)
  const hasArgumentsField = /"arguments"\s*:\s*\{/.test(trimmed)

  if (!hasNameField || !hasArgumentsField) {
    return false
  }

  // Additional check: make sure it's not just a fragment (should have closing brace)
  const openBraces = (trimmed.match(/\{/g) || []).length
  const closeBraces = (trimmed.match(/\}/g) || []).length

  const isValid = openBraces > 0 && closeBraces >= openBraces - 1
  logForDebugging(`looksLikeJsonToolCall: hasName=${hasNameField}, hasArgs=${hasArgumentsField}, braces=${openBraces}/${closeBraces}, result=${isValid}`)
  return isValid
}

/**
 * Extract tool call JSON from model output.
 * Returns an array of extracted tool call objects.
 */
export function extractJsonToolCalls(text: string): Array<{ name: string; arguments: unknown }> {
  const results: Array<{ name: string; arguments: unknown }> = []

  // First, try to find array of tool calls
  const arrayMatch = text.match(TOOL_CALLS_ARRAY_PATTERN)
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0])
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item === 'object' && 'name' in item && 'arguments' in item) {
            results.push({
              name: String(item.name),
              arguments: item.arguments,
            })
          }
        }
      }
    } catch {
      // Fall through to individual object parsing
    }
  }

  // Try to extract individual JSON objects with name/arguments
  // This handles both standalone objects and objects embedded in text
  let braceStart = -1
  let braceCount = 0
  let inString = false
  let escapeNext = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]

    if (escapeNext) {
      escapeNext = false
      continue
    }

    if (char === '\\') {
      escapeNext = true
      continue
    }

    if (char === '"' && !escapeNext) {
      inString = !inString
      continue
    }

    if (!inString) {
      if (char === '{') {
        if (braceStart === -1) {
          braceStart = i
        }
        braceCount++
      } else if (char === '}') {
        braceCount--
        if (braceCount === 0 && braceStart !== -1) {
          // Found a complete object
          const jsonStr = text.slice(braceStart, i + 1)
          try {
            const parsed = JSON.parse(jsonStr)
            if (parsed && typeof parsed === 'object' && 'name' in parsed && 'arguments' in parsed) {
              const name = String(parsed.name)
              if (isKnownTool(name)) {
                results.push({
                  name,
                  arguments: parsed.arguments,
                })
              }
            }
          } catch {
            // Not valid JSON, skip
          }
          braceStart = -1
        }
      }
    }
  }

  return results
}

/**
 * Check if a tool name is recognized.
 */
function isKnownTool(name: string): boolean {
  for (const known of KNOWN_TOOLS) {
    if (name === known || name.startsWith(known)) {
      return true
    }
  }
  return false
}

/**
 * Generate a unique ID for a tool use.
 */
function generateToolUseId(index: number): string {
  return `ollama_tool_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Convert extracted JSON tool calls into Anthropic-format tool_use blocks.
 */
export function convertJsonToolCallsToToolUse(
  jsonCalls: Array<{ name: string; arguments: unknown }>,
): Array<{
  type: 'tool_use'
  id: string
  name: string
  input: unknown
}> {
  return jsonCalls.map((call, index) => ({
    type: 'tool_use' as const,
    id: generateToolUseId(index),
    name: call.name,
    input: call.arguments,
  }))
}

/**
 * Insert tool_use blocks into the content array, replacing the JSON text.
 * This should be called after detecting JSON tool calls in the output.
 */
export function replaceJsonWithToolUseBlocks(
  content: Array<{ type: string; text?: string }>,
  textIndex: number,
  jsonCalls: Array<{ name: string; arguments: unknown }>,
): Array<{ type: string; text?: string } | { type: 'tool_use'; id: string; name: string; input: unknown }> {
  const result: Array<{ type: string; text?: string } | { type: 'tool_use'; id: string; name: string; input: unknown }> = []

  for (let i = 0; i < content.length; i++) {
    if (i === textIndex) {
      const textBlock = content[i]
      if (textBlock.text) {
        // Add tool_use blocks before the text
        const toolBlocks = convertJsonToolCallsToToolUse(jsonCalls)
        result.push(...toolBlocks)

        // Optionally keep the original text (for debugging) or remove it
        // For cleaner output, we'll remove the JSON text
        logForDebugging(`Replaced ${jsonCalls.length} JSON tool calls with proper tool_use blocks`)
      }
    } else {
      result.push(content[i])
    }
  }

  return result
}

/**
 * Main entry point: process an assistant message that might contain JSON tool calls.
 * Returns modified content with proper tool_use blocks if JSON was detected.
 */
export function processOllamaToolCallOutput(
  content: unknown,
): {
  modifiedContent: Array<{ type: string; text?: string } | { type: 'tool_use'; id: string; name: string; input: unknown }>
  toolCallsFound: number
} {
  if (!Array.isArray(content)) {
    return { modifiedContent: [content as { type: string; text?: string }], toolCallsFound: 0 }
  }

  // Find text blocks that might contain JSON tool calls
  for (let i = 0; i < content.length; i++) {
    const block = content[i]
    if (block?.type === 'text' && typeof block.text === 'string') {
      if (looksLikeJsonToolCall(block.text)) {
        const jsonCalls = extractJsonToolCalls(block.text)
        if (jsonCalls.length > 0) {
          logForDebugging(`Ollama adapter: detected ${jsonCalls.length} JSON tool calls in output`)
          const modifiedContent = replaceJsonWithToolUseBlocks(content as Array<{ type: string; text?: string }>, i, jsonCalls)
          return { modifiedContent, toolCallsFound: jsonCalls.length }
        }
      }
    }
  }

  return { modifiedContent: content as Array<{ type: string; text?: string } | { type: 'tool_use'; id: string; name: string; input: unknown }>, toolCallsFound: 0 }
}
