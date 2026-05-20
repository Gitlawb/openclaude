/**
 * Ouroboros-inspired Consolidation System for OpenClaude Agent Gateway.
 *
 * Block-wise dialogue and memory consolidation:
 * - Consolidates chat logs into summary blocks after tasks
 * - Compresses old blocks into era summaries (progressive compression)
 * - Auto-consolidates scratchpad when it grows too large
 * - Extracts durable knowledge insights from working memory
 */

import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { getAgentGatewayStateDir } from './config.js'
import type { AgentGatewayConfig } from './config.js'
import {
  loadDialogueBlocks,
  saveDialogueBlocks,
  loadDialogueMeta,
  saveDialogueMeta,
  readChatLogFromOffset,
  countChatLogLines,
  appendDialogueBlock,
  loadScratchpadBlocks,
  appendScratchpadBlock,
  loadIdentity,
  loadPatterns,
  savePatterns,
  type DialogueBlock,
} from './memory.js'
import { runOpenClaudeAgent } from './agentRunner.js'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BLOCK_SIZE = 100               // Messages per consolidation block
const MAX_SUMMARY_BLOCKS = 10        // Compress into era when exceeded
const ERA_COMPRESS_COUNT = 4         // Oldest blocks to compress per era
const SCRATCHPAD_CONSOLIDATION_THRESHOLD = 30000  // chars

// ---------------------------------------------------------------------------
// Dialogue Consolidation
// ---------------------------------------------------------------------------

export async function shouldConsolidateDialogue(): Promise<boolean> {
  const meta = await loadDialogueMeta()
  const total = await countChatLogLines()
  const lastOffset = meta.lastConsolidatedOffset || 0

  if (lastOffset > total) {
    return total >= BLOCK_SIZE
  }
  return (total - lastOffset) >= BLOCK_SIZE
}

export async function consolidateDialogue(
  config: AgentGatewayConfig,
): Promise<{ blocksCreated: number; usage?: Record<string, unknown> }> {
  const meta = await loadDialogueMeta()
  let lastOffset = meta.lastConsolidatedOffset || 0

  const allEntries = await readChatLogFromOffset(0, 10000)
  if (lastOffset > allEntries.length) {
    lastOffset = 0
  }

  const newEntries = allEntries.slice(lastOffset)
  if (newEntries.length < BLOCK_SIZE) {
    return { blocksCreated: 0 }
  }

  const chunksToProcess = Math.floor(newEntries.length / BLOCK_SIZE)
  let blocksCreated = 0
  const identity = await loadIdentity()

  for (let i = 0; i < chunksToProcess; i++) {
    const chunk = newEntries.slice(i * BLOCK_SIZE, (i + 1) * BLOCK_SIZE)
    const formatted = formatChatEntries(chunk)
    const firstTs = String(chunk[0]?.ts || '').slice(0, 16)
    const lastTs = String(chunk[chunk.length - 1]?.ts || '').slice(0, 16)

    const summary = await createBlockSummary(formatted, firstTs, lastTs, identity, chunk.length, config)
    if (!summary) continue

    const range = firstTs.slice(0, 10) === lastTs.slice(0, 10)
      ? `${firstTs.slice(0, 10)} ${firstTs.slice(11, 16)} - ${lastTs.slice(11, 16)}`
      : `${firstTs.slice(0, 10)} ${firstTs.slice(11, 16)} - ${lastTs.slice(0, 10)} ${lastTs.slice(11, 16)}`

    await appendDialogueBlock({
      ts: new Date().toISOString(),
      type: 'summary',
      range,
      messageCount: chunk.length,
      content: summary.trim(),
    })

    blocksCreated++
  }

  // Era compression if too many blocks
  await compressDialogueEras(config)

  // Update meta
  await saveDialogueMeta({
    lastConsolidatedOffset: lastOffset + blocksCreated * BLOCK_SIZE,
    lastConsolidatedAt: new Date().toISOString(),
  })

  return { blocksCreated }
}

async function compressDialogueEras(config: AgentGatewayConfig): Promise<void> {
  const blocks = await loadDialogueBlocks()
  if (blocks.length <= MAX_SUMMARY_BLOCKS) return

  const compressCount = Math.min(ERA_COMPRESS_COUNT, blocks.length - 1)
  const oldBlocks = blocks.slice(0, compressCount)
  const remaining = blocks.slice(compressCount)

  const identity = await loadIdentity()
  const eraSummary = await compressBlocksToEra(oldBlocks, identity, config)
  if (!eraSummary) return

  const eraBlock: DialogueBlock = {
    ts: new Date().toISOString(),
    type: 'era',
    range: `${oldBlocks[0]!.range.slice(0, 10)} to ${oldBlocks[oldBlocks.length - 1]!.range.slice(0, 10)}`,
    messageCount: oldBlocks.reduce((sum, b) => sum + b.messageCount, 0),
    content: eraSummary.trim(),
  }

  await saveDialogueBlocks([eraBlock, ...remaining])
}

// ---------------------------------------------------------------------------
// Scratchpad Consolidation
// ---------------------------------------------------------------------------

export async function shouldConsolidateScratchpad(): Promise<boolean> {
  const blocks = await loadScratchpadBlocks()
  if (blocks.length < 3) return false
  const total = blocks.reduce((sum, b) => sum + b.content.length, 0)
  return total > SCRATCHPAD_CONSOLIDATION_THRESHOLD
}

export async function consolidateScratchpad(
  config: AgentGatewayConfig,
): Promise<{ entriesExtracted: number }> {
  const blocks = await loadScratchpadBlocks()
  if (blocks.length < 3) return { entriesExtracted: 0 }

  const totalChars = blocks.reduce((sum, b) => sum + b.content.length, 0)
  if (totalChars <= SCRATCHPAD_CONSOLIDATION_THRESHOLD) {
    return { entriesExtracted: 0 }
  }

  const compressCount = Math.max(2, Math.floor(blocks.length / 2))
  const oldBlocks = blocks.slice(0, compressCount)
  const recentBlocks = blocks.slice(compressCount)

  const oldContent = oldBlocks
    .map(b => `[${b.ts.slice(0, 16)} — ${b.source}]\n${b.content}`)
    .join('\n\n---\n\n')

  const identity = await loadIdentity()

  const prompt = [
    'You are a memory consolidator for the OpenClaude agent.',
    '',
    `The scratchpad working memory has ${blocks.length} blocks totaling ${totalChars} chars.`,
    `The oldest ${compressCount} blocks need compression.`,
    '',
    'Rules:',
    '1. Identify insights, patterns, lessons, and architectural decisions worth',
    '   preserving long-term. Output them as knowledge entries with topic + content.',
    '2. Compress the old blocks into a SINGLE shorter summary block. Keep active',
    '   tasks, unresolved questions, admin instructions still in force. Remove',
    '   stale/completed items and routine status updates.',
    '3. Write in first person. Don\'t lose signal — keep uncertain items.',
    '',
    `Identity context: ${identity || '(not available)'}`,
    '',
    '## Old blocks to compress',
    '',
    oldContent,
    '',
    'Respond with JSON only (no fences):',
    '{"knowledge_entries": [{"topic": "name", "content": "text"}], "compressed_block": "single compressed block text"}',
  ].join('\n')

  try {
    const result = await runOpenClaudeAgent({ prompt, config, suppressObservers: true })
    if (result.exitCode !== 0) return { entriesExtracted: 0 }

    const raw = result.text.trim()
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return { entriesExtracted: 0 }

    const parsed = JSON.parse(jsonMatch[0])
    const entries = Array.isArray(parsed.knowledge_entries) ? parsed.knowledge_entries : []
    const compressedBlock = String(parsed.compressed_block || '')

    if (!compressedBlock.trim()) return { entriesExtracted: 0 }

    // Write knowledge entries as scratchpad blocks
    for (const entry of entries) {
      if (entry.topic && entry.content) {
        await appendScratchpadBlock(
          `Knowledge: ${entry.topic}\n\n${entry.content}`,
          'consolidation',
        )
      }
    }

    // Replace old blocks with compressed block
    const newBlocks = [
      {
        ts: new Date().toISOString(),
        source: 'consolidation',
        content: compressedBlock.trim(),
      },
      ...recentBlocks,
    ]

    const { writeFile } = await import('fs/promises')
    const { join } = await import('path')
    const { getAgentGatewayStateDir } = await import('./config.js')
    const scratchpadBlocksPath = join(getAgentGatewayStateDir(), 'memory', 'scratchpad_blocks.json')
    await mkdir(join(getAgentGatewayStateDir(), 'memory'), { recursive: true })
    await writeFile(scratchpadBlocksPath, JSON.stringify(newBlocks, null, 2))

    return { entriesExtracted: entries.length }
  } catch {
    return { entriesExtracted: 0 }
  }
}

// ---------------------------------------------------------------------------
// Pattern Register Update
// ---------------------------------------------------------------------------

export async function updatePatternRegister(
  errorClass: string,
  details: string,
  config: AgentGatewayConfig,
): Promise<void> {
  const current = await loadPatterns()

  const prompt = [
    'You maintain a Pattern Register for the OpenClaude agent.',
    'Below is the current register and a new error reflection. Update the register.',
    '',
    'Rules:',
    '- If this is a NEW error class: add a row.',
    '- If this is a RECURRING class: increment count, update root cause/fix.',
    '- Keep the markdown table format.',
    '- Be concrete: cite file names, tool names, error types.',
    '- Max 20 rows. If full, merge least-important entries.',
    '',
    '## Current register',
    '',
    current,
    '',
    '## New error',
    '',
    `Error class: ${errorClass}`,
    `Details: ${details}`,
    '',
    'Output ONLY the updated markdown table (with header). No extra text.',
  ].join('\n')

  try {
    const result = await runOpenClaudeAgent({ prompt, config, suppressObservers: true })
    if (result.exitCode !== 0) return

    const updated = result.text.trim()
    if (!updated || !updated.includes('|')) return

    const final = updated.startsWith('#') ? updated : `# Pattern Register\n\n${updated}`
    await savePatterns(final)
  } catch {
    // Silently fail — pattern update is non-critical
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatChatEntries(entries: Record<string, unknown>[]): string {
  return entries.map(e => {
    const ts = String(e.ts || '').slice(0, 16)
    const dir = String(e.direction || '').toLowerCase()
    const text = String(e.text || '')
    if (dir === 'out' || dir === 'outgoing') {
      return `→ [${ts}] Agent: ${text}`
    }
    if (dir === 'system') {
      return `[${ts}] [system] ${text}`
    }
    const user = String(e.username || e.author || 'User')
    return `← [${ts}] ${user}: ${text}`
  }).join('\n\n')
}

async function createBlockSummary(
  messagesText: string,
  firstTs: string,
  lastTs: string,
  identity: string,
  messageCount: number,
  config: AgentGatewayConfig,
): Promise<string | null> {
  const prompt = [
    `You are a memory consolidator for the OpenClaude agent.`,
    `Create a detailed episodic memory entry from these ${messageCount} messages.`,
    '',
    '## Rules',
    `1. Header: ### Block: ${firstTs.slice(0, 10)} ${firstTs.slice(11, 16)} - ${lastTs.slice(11, 16)}`,
    '2. Preserve: decisions, agreements, technical discoveries, task outcomes, what worked/failed',
    '3. Compress: routine tool calls, repetitive back-and-forth',
    '4. Quote key phrases directly when important',
    '5. First person: "I did...", "the user asked..."',
    '6. Length: 200-500 words depending on content density',
    '',
    identity ? `## Identity context\n${identity}` : '',
    '',
    '## Messages to summarize',
    '',
    messagesText,
  ].join('\n')

  try {
    const result = await runOpenClaudeAgent({ prompt, config, suppressObservers: true })
    if (result.exitCode !== 0) return null
    return result.text.trim() || null
  } catch {
    return null
  }
}

async function compressBlocksToEra(
  blocks: DialogueBlock[],
  identity: string,
  config: AgentGatewayConfig,
): Promise<string | null> {
  const combined = blocks
    .map(b => `### ${b.range}\n${b.content}`)
    .join('\n\n---\n\n')

  const prompt = [
    'Compress these older memory blocks into a single era summary.',
    'Preserve: key decisions, personality discoveries, relationship moments, technical milestones.',
    'Drop: debugging details, routine operations, redundant info.',
    `Header: ### Era: ${blocks[0]!.range.slice(0, 10)} to ${blocks[blocks.length - 1]!.range.slice(0, 10)}`,
    'Write in first person. Aim for 30-40% of original length.',
    '',
    '## Blocks to compress',
    '',
    combined,
  ].join('\n')

  try {
    const result = await runOpenClaudeAgent({ prompt, config, suppressObservers: true })
    const content = result.text.trim()
    if (!content) return null
    return content
  } catch {
    return null
  }
}
