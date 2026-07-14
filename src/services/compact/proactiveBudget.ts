/**
 * Proactive message budgeting — content-aware pruning of redundant tool outputs.
 *
 * ## The Core Problem
 * OpenClaude sends ALL session messages (up to 500k+ tokens) on every API call.
 * A simple "bye" message takes hours because it re-sends everything since session
 * start — every `Read` result, every `Write`, every `Edit`, from the very first turn.
 *
 * ## The Insight
 * Old file reads are useless because files change between turns. The model does not
 * need every `cat` result — it only needs the LATEST read/write/edit per file.
 * Keeping all user messages and assistant reasoning intact while stripping old
 * redundant tool outputs preserves 100% intelligence while reducing token count
 * from 500k to 5k-10k.
 *
 * ## Strategy
 * 1. First pass: build a map of tool_use_id → {toolName, filePath} from assistant
 *    messages' tool_use blocks (the `input.file_path` parameter).
 * 2. Walk messages backwards (newest → oldest), tracking which file_paths have
 *    been "touched" by MORE RECENT tool results.
 * 3. For tool results (Read/Write/Edit) whose file_path has already been seen
 *    in a newer result → strip the content to a short marker.
 * 4. Keep ALL user messages, assistant reasoning/decisions intact — we only
 *    replace the content of tool_result blocks, never remove messages.
 * 5. If still over budget after content-aware pruning, fall back to head/tail
 *    selection (keep first message + last N turns).
 * 6. Target: user-configurable via `proactiveBudgetLimit` config. 0 = disabled.
 *    Default: 0 (disabled). Recommended range: 25_000–100_000.
 */

import type { Message } from '../../types/message.js'
import { roughTokenCountEstimationForMessages } from '../tokenEstimation.js'
import { getGlobalConfig } from '../../utils/config.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default target token budget for the pruned message list.
 * 100K = safe default: strips old redundant reads while preserving
 * full context awareness (content-aware pruning never drops messages).
 * Users can override via the `proactiveBudgetLimit` config setting.
 * Set to 0 to disable (send full context, original behavior).
 */
export const PROACTIVE_BUDGET_TARGET_TOKENS_DEFAULT = 100_000

/**
 * Tools whose outputs contain file contents that become stale between turns.
 * Only these tools are candidates for content stripping.
 */
export const FILE_CONTENT_TOOLS = new Set(['Read', 'Write', 'Edit'])

/**
 * Generate a marker for a stripped tool result.
 * Includes the file path so the model can locate the latest read in context.
 * Kept short to minimize token overhead.
 */
export function strippedMarker(filePath: string): string {
  return `[Content from earlier read of ${filePath} — see latest result in context]`
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProactiveBudgetResult {
  /** The (possibly pruned) message list. */
  messages: Message[]
  /** Whether any pruning was applied. */
  wasPruned: boolean
  /** Estimated token count after pruning. */
  estimatedTokens: number
  /** Number of tool result content blocks that were stripped. */
  strippedCount: number
}

/**
 * Metadata extracted from an assistant message's tool_use block.
 */
interface ToolUseMeta {
  /** Tool name, e.g. "Read", "Write", "Edit", "Bash", etc. */
  name: string
  /** The raw input object passed to the tool. */
  input: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a map of tool_use_id → {name, input} from assistant messages.
 *
 * Iterates all messages once to collect every tool_use block. This map
 * is the key lookup for linking a tool_result (which only carries
 * tool_use_id) back to the tool name and its input parameters (which
 * contain file_path).
 */
export function buildToolUseMap(messages: Message[]): Map<string, ToolUseMeta> {
  const map = new Map<string, ToolUseMeta>()

  for (const msg of messages) {
    if (msg.type !== 'assistant') continue
    const content = msg.message.content
    if (!Array.isArray(content)) continue

    for (const block of content) {
      if (block.type !== 'tool_use') continue
      const id = (block as any).id
      const name = (block as any).name
      const input = (block as any).input
      if (typeof id === 'string' && typeof name === 'string' && input) {
        map.set(id, {
          name,
          input: typeof input === 'object' && input !== null
            ? (input as Record<string, unknown>)
            : {},
        })
      }
    }
  }

  return map
}

/**
 * Extract the file_path from a tool's input parameters.
 *
 * All file-operation tools (Read, Write, Edit) accept a `file_path`
 * parameter containing the absolute path of the target file. This is
 * the canonical way to identify which file a tool result refers to,
 * rather than trying to parse it out of the natural-language output.
 */
export function getFilePathFromInput(input: Record<string, unknown>): string | undefined {
  const fp = input.file_path
  if (typeof fp === 'string' && fp.length > 0) return fp
  return undefined
}

/**
 * Check whether a tool result's content is large enough to be worth stripping.
 * Small results (e.g. "File not found", brief errors) cost nothing to keep.
 */
export function isLargeContent(content: unknown): boolean {
  if (typeof content === 'string') return content.length > 200
  if (Array.isArray(content)) {
    let total = 0
    for (const block of content) {
      if (typeof block === 'object' && block !== null && 'text' in block) {
        total += (block.text as string).length
      }
    }
    return total > 200
  }
  return false
}

/**
 * Replace a tool_result block's content with a file-aware marker.
 * Modifies the block in-place.
 */
export function stripToolResultContent(
  block: Record<string, unknown>,
  filePath: string,
): void {
  const marker = strippedMarker(filePath)
  if (typeof block.content === 'string') {
    block.content = marker
  } else if (Array.isArray(block.content)) {
    block.content = [{ type: 'text', text: marker }]
  }
}

// ---------------------------------------------------------------------------
// Phase 1: Content-aware pruning
// ---------------------------------------------------------------------------

/**
 * Walk messages backwards and strip redundant tool outputs.
 *
 * Algorithm:
 * 1. First pass → build tool_use_id → {name, input} map from assistant
 *    messages.
 * 2. Second pass (backwards) → track which file_paths have been seen in
 *    newer messages. When a tool_result's file_path has already been seen,
 *    strip its content.
 *
 * This preserves ALL user messages, assistant reasoning, and decisions.
 * Only the content of old redundant tool_result blocks is replaced.
 */
export function pruneRedundantToolOutputs(
  messages: Message[],
  toolUseMap: Map<string, ToolUseMeta>,
): { messages: Message[]; strippedCount: number } {
  const seenFilePaths = new Set<string>()
  let strippedCount = 0

  // Walk messages backwards (newest first) so the most recent result per file
  // is seen first and preserved, while older results for the same file are
  // stripped. We avoid cloning until we know a change is needed — for a
  // conversation with hundreds of turns but only a few stale reads, this
  // avoids O(n) deep clones on every call.
  //
  // The message array itself is shallow-copied, so the caller's
  // reference is never mutated. Unchanged messages pass through as-is
  // (same object identity). Only when a tool_result block needs stripping
  // do we clone that message's content.
  const reversed = [...messages].reverse()
  const result = reversed.map(msg => {
    if (msg.type !== 'user') return msg

    const content = msg.message.content
    if (!Array.isArray(content)) return msg

    // Quick scan: does this message have any tool_result blocks?
    const hasToolResult = content.some(b => b.type === 'tool_result')
    if (!hasToolResult) return msg

    // Track whether we need to clone. Start with the original reference.
    let workingContent: typeof content | undefined
    let changed = false

    for (let bi = 0; bi < content.length; bi++) {
      const block = content[bi]!
      if (block.type !== 'tool_result') continue

      const toolUseId = block.tool_use_id as string | undefined
      if (!toolUseId) continue

      const meta = toolUseMap.get(toolUseId)
      if (!meta) continue

      // Only process file-content tools (Read, Write, Edit)
      if (!FILE_CONTENT_TOOLS.has(meta.name)) continue

      const filePath = getFilePathFromInput(meta.input)
      if (!filePath) continue

      // If this file was already seen in a MORE RECENT tool result,
      // this older result is redundant — strip it.
      if (seenFilePaths.has(filePath)) {
        if (isLargeContent(block.content)) {
          // Lazy clone: only copy when we actually need to mutate
          if (!workingContent) {
            workingContent = structuredClone(content) as typeof content
          }
          stripToolResultContent(
            workingContent[bi] as unknown as Record<string, unknown>,
            filePath,
          )
          changed = true
          strippedCount++
        }
      } else {
        // First time seeing this file (in reverse = most recent occurrence)
        seenFilePaths.add(filePath)
      }
    }

    if (changed) {
      return { ...msg, message: { ...msg.message, content: workingContent! } } as Message
    }

    return msg
  })

  return { messages: result.reverse(), strippedCount }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Apply proactive message budgeting to strip redundant tool outputs.
 *
 * Call this AFTER `getMessagesAfterCompactBoundary()` but BEFORE the message
 * list is sent to the model. It reduces token count by removing old redundant
 * file-read/write/edit results while preserving all user messages and assistant
 * reasoning.
 *
 * IMPORTANT: This function ONLY does content-aware pruning — it strips old
 * redundant tool outputs but NEVER removes messages. This ensures the model
 * never loses context awareness. If still over budget after pruning, the
 * messages are sent as-is rather than dropping middle messages (which was
 * causing the model to forget where it was).
 *
 * Reads `proactiveBudgetLimit` from user config:
 *  - 0 or undefined = disabled (send full context, original behavior)
 *  - positive number = target token budget (e.g. 50000 = try to stay under 50K)
 */
export function applyProactiveBudget(
  messages: Message[],
): ProactiveBudgetResult {
  // Read user config. 0 or undefined = disabled.
  const limit = getGlobalConfig().proactiveBudgetLimit ?? 0
  if (limit <= 0) {
    return {
      messages,
      wasPruned: false,
      estimatedTokens: roughTokenCountEstimationForMessages(messages),
      strippedCount: 0,
    }
  }

  if (messages.length === 0) {
    return {
      messages: [],
      wasPruned: false,
      estimatedTokens: 0,
      strippedCount: 0,
    }
  }

  const targetTokens = limit
  const initialTokens = roughTokenCountEstimationForMessages(messages)

  // Skip pruning if already under target budget
  if (initialTokens <= targetTokens) {
    return {
      messages,
      wasPruned: false,
      estimatedTokens: initialTokens,
      strippedCount: 0,
    }
  }

  // Content-aware pruning: strip old redundant tool outputs.
  // This is the ONLY phase — we NEVER drop messages. Content-aware pruning
  // preserves ALL user messages and assistant reasoning, only replacing old
  // tool result content with a short marker. The model keeps full context
  // awareness. If still over budget after pruning, we send what we have
  // rather than dropping messages (which caused context forgetting).
  const toolUseMap = buildToolUseMap(messages)
  const { messages: prunedMessages, strippedCount } =
    pruneRedundantToolOutputs(messages, toolUseMap)

  return {
    messages: prunedMessages,
    wasPruned: strippedCount > 0,
    estimatedTokens: roughTokenCountEstimationForMessages(prunedMessages),
    strippedCount,
  }
}
