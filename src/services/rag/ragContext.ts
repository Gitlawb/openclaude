/**
 * Injects hybrid RAG hits into the main OpenClaude system prompt each turn
 * (same index as web upload / leader — persisted under ~/.openclaude/pentest/rag.sqlite).
 */
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { ragHybridRetrieve } from './rag.js'

/** Matches prompts.ts default: unset OPENCLAUDE_PROMPT_PROFILE ⇒ pentest. */
function promptProfileIsPentest(): boolean {
  return (process.env.OPENCLAUDE_PROMPT_PROFILE || 'pentest').toLowerCase() === 'pentest'
}

/** Pentest profile enables RAG; other profiles need OPENCLAUDE_CONTEXT_RAG=1. */
export function isPentestContextRagEnabled(): boolean {
  if (isEnvTruthy(process.env.OPENCLAUDE_CONTEXT_RAG_DISABLED)) return false
  if (promptProfileIsPentest()) return true
  return isEnvTruthy(process.env.OPENCLAUDE_CONTEXT_RAG)
}

export function promptToRagQuery(prompt: string | ContentBlockParam[]): string {
  if (typeof prompt === 'string') return prompt
  const parts: string[] = []
  for (const block of prompt) {
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text)
    }
  }
  return parts.join('\n')
}

/** Default RAG injection cap (chars). Override with OPENCLAUDE_PENTEST_RAG_MAX_CHARS. */
const DEFAULT_MAX_CHARS = 4_500

/**
 * Returns a system-prompt segment with top retrieved chunks, or undefined if
 * disabled, empty query, or no index data.
 */
export function buildPentestRagSystemExtension(
  userQueryPlainText: string,
): string | undefined {
  if (!isPentestContextRagEnabled()) return undefined
  const q = userQueryPlainText.trim()
  if (!q) return undefined

  const hits = ragHybridRetrieve(q)
  if (hits.length === 0) return undefined

  const maxCharsRaw = process.env.OPENCLAUDE_PENTEST_RAG_MAX_CHARS
  const maxChars =
    maxCharsRaw !== undefined && maxCharsRaw !== ''
      ? Math.max(500, Number(maxCharsRaw) || DEFAULT_MAX_CHARS)
      : DEFAULT_MAX_CHARS

  const lines: string[] = ['## RAG snippets (use if relevant; else ignore)\n']
  let used = lines.join('\n').length
  for (const h of hits) {
    const block = `### ${h.title}\n${h.text}\n\n`
    if (used + block.length > maxChars) break
    lines.push(block)
    used += block.length
  }
  return lines.join('\n').trimEnd()
}
