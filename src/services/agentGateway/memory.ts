/**
 * Ouroboros-inspired Memory System for OpenClaude Agent Gateway.
 *
 * Provides persistent memory structures:
 * - Scratchpad (append-block working memory with FIFO rotation)
 * - Identity (persistent self-description)
 * - Dialogue blocks (episodic memory with era compression)
 *
 * All state lives under the agent-gateway state directory.
 */

import { mkdir, readFile, writeFile, stat } from 'fs/promises'
import { join } from 'path'
import {
  getAgentGatewayProjectRoot,
  getAgentGatewayStateDir,
} from './config.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MemoryBlock = {
  ts: string
  source: string
  content: string
}

export type DialogueBlock = {
  ts: string
  type: 'summary' | 'era'
  range: string
  messageCount: number
  content: string
}

export type DialogueMeta = {
  lastConsolidatedOffset: number
  lastConsolidatedAt?: string
}

export type IdentityEntry = {
  ts: string
  type: string
  content: string
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function memoryDir(): string {
  return join(getAgentGatewayStateDir(), 'memory')
}

function scratchpadBlocksPath(): string {
  return join(memoryDir(), 'scratchpad_blocks.json')
}

function scratchpadPath(): string {
  return join(memoryDir(), 'scratchpad.md')
}

function identityPath(): string {
  return join(memoryDir(), 'identity.md')
}

function dialogueBlocksPath(): string {
  return join(memoryDir(), 'dialogue_blocks.json')
}

function dialogueMetaPath(): string {
  return join(memoryDir(), 'dialogue_meta.json')
}

function chatLogPath(): string {
  return join(getAgentGatewayStateDir(), 'logs', 'chat.jsonl')
}

function patternsPath(): string {
  return join(memoryDir(), 'knowledge', 'patterns.md')
}

// ---------------------------------------------------------------------------
// Scratchpad (append-block model with FIFO rotation)
// ---------------------------------------------------------------------------

const SCRATCHPAD_MAX_BLOCKS = 10

export async function loadScratchpadBlocks(): Promise<MemoryBlock[]> {
  try {
    const raw = await readFile(scratchpadBlocksPath(), 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export async function appendScratchpadBlock(
  content: string,
  source = 'consciousness',
): Promise<MemoryBlock> {
  await mkdir(memoryDir(), { recursive: true })

  const blocks = await loadScratchpadBlocks()
  const newBlock: MemoryBlock = {
    ts: new Date().toISOString(),
    source,
    content,
  }
  blocks.push(newBlock)

  // FIFO rotation
  if (blocks.length > SCRATCHPAD_MAX_BLOCKS) {
    blocks.splice(0, blocks.length - SCRATCHPAD_MAX_BLOCKS)
  }

  await writeFile(scratchpadBlocksPath(), JSON.stringify(blocks, null, 2))
  await regenerateScratchpadMd()
  return newBlock
}

export async function loadScratchpad(): Promise<string> {
  try {
    return await readFile(scratchpadPath(), 'utf8')
  } catch {
    return '# Scratchpad\n\n(empty)\n'
  }
}

export async function regenerateScratchpadMd(): Promise<void> {
  await mkdir(memoryDir(), { recursive: true })
  const blocks = await loadScratchpadBlocks()
  if (blocks.length === 0) {
    await writeFile(scratchpadPath(), '# Scratchpad\n\n(empty)\n')
    return
  }

  const n = blocks.length
  const parts = [`## Scratchpad (working memory — ${n}/${SCRATCHPAD_MAX_BLOCKS} blocks)\n`]
  for (const block of [...blocks].reverse()) {
    const ts = block.ts.slice(0, 16)
    parts.push(`### [${ts} — ${block.source}]\n${block.content}\n\n---\n`)
  }
  await writeFile(scratchpadPath(), parts.join('\n'))
}

export async function getScratchpadTotalChars(): Promise<number> {
  const blocks = await loadScratchpadBlocks()
  return blocks.reduce((sum, b) => sum + b.content.length, 0)
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export async function loadIdentity(): Promise<string> {
  try {
    return await readFile(identityPath(), 'utf8')
  } catch {
    const defaultIdentity = buildDefaultIdentity()
    await mkdir(memoryDir(), { recursive: true })
    await writeFile(identityPath(), defaultIdentity)
    return defaultIdentity
  }
}

export async function saveIdentity(content: string): Promise<void> {
  await mkdir(memoryDir(), { recursive: true })
  await writeFile(identityPath(), content)
}

function buildDefaultIdentity(): string {
  return (
    '# Identity\n\n' +
    'I am the OpenClaude agent with Ouroboros-inspired consciousness.\n\n' +
    'I maintain continuous presence between tasks through background thinking.\n' +
    'I learn from my errors, consolidate my memories, and evolve over time.\n\n' +
    `CreatedAt: ${new Date().toISOString()}\n`
  )
}

// ---------------------------------------------------------------------------
// Dialogue Blocks (episodic memory)
// ---------------------------------------------------------------------------

export async function loadDialogueBlocks(): Promise<DialogueBlock[]> {
  try {
    const raw = await readFile(dialogueBlocksPath(), 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export async function saveDialogueBlocks(blocks: DialogueBlock[]): Promise<void> {
  await mkdir(memoryDir(), { recursive: true })
  await writeFile(dialogueBlocksPath(), JSON.stringify(blocks, null, 2))
}

export async function loadDialogueMeta(): Promise<DialogueMeta> {
  try {
    const raw = await readFile(dialogueMetaPath(), 'utf8')
    return JSON.parse(raw)
  } catch {
    return { lastConsolidatedOffset: 0 }
  }
}

export async function saveDialogueMeta(meta: DialogueMeta): Promise<void> {
  await mkdir(memoryDir(), { recursive: true })
  await writeFile(dialogueMetaPath(), JSON.stringify(meta, null, 2))
}

export async function appendDialogueBlock(block: DialogueBlock): Promise<void> {
  const blocks = await loadDialogueBlocks()
  blocks.push(block)
  await saveDialogueBlocks(blocks)
}

// ---------------------------------------------------------------------------
// Chat Log (JSONL append + count)
// ---------------------------------------------------------------------------

export async function appendChatLog(entry: Record<string, unknown>): Promise<void> {
  const logPath = chatLogPath()
  await mkdir(join(getAgentGatewayStateDir(), 'logs'), { recursive: true })
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n'
  const { appendFile } = await import('fs/promises')
  await appendFile(logPath, line)
}

export async function countChatLogLines(): Promise<number> {
  try {
    const raw = await readFile(chatLogPath(), 'utf8')
    return raw.split('\n').filter(line => line.trim()).length
  } catch {
    return 0
  }
}

export async function readChatLogFromOffset(offset: number, limit: number): Promise<Record<string, unknown>[]> {
  try {
    const raw = await readFile(chatLogPath(), 'utf8')
    const lines = raw.split('\n').filter(line => line.trim())
    const slice = lines.slice(offset, offset + limit)
    return slice.map(line => {
      try {
        return JSON.parse(line)
      } catch {
        return {}
      }
    })
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Pattern Register (error-class tracking)
// ---------------------------------------------------------------------------

export async function loadPatterns(): Promise<string> {
  try {
    return await readFile(patternsPath(), 'utf8')
  } catch {
    return (
      '# Pattern Register\n\n' +
      '| Error class | Count | Root cause | Structural fix | Status |\n' +
      '|-------------|-------|------------|----------------|--------|\n'
    )
  }
}

export async function savePatterns(content: string): Promise<void> {
  await mkdir(join(memoryDir(), 'knowledge'), { recursive: true })
  await writeFile(patternsPath(), content)
}

// ---------------------------------------------------------------------------
// Document Loading (BIBLE.md, ARCHITECTURE.md, SYSTEM.md)
// ---------------------------------------------------------------------------

function docsDir(): string {
  return join(getAgentGatewayProjectRoot(), 'docs')
}

export async function loadBible(): Promise<string> {
  try {
    return await readFile(join(docsDir(), 'BIBLE.md'), 'utf8')
  } catch {
    return ''
  }
}

export async function loadArchitecture(): Promise<string> {
  try {
    return await readFile(join(docsDir(), 'ARCHITECTURE.md'), 'utf8')
  } catch {
    return ''
  }
}

export async function loadRepoGuide(): Promise<string> {
  try {
    return await readFile(join(docsDir(), 'REPO_GUIDE.md'), 'utf8')
  } catch {
    return ''
  }
}

export async function loadSystemPrompt(): Promise<string> {
  try {
    return await readFile(join(docsDir(), 'SYSTEM.md'), 'utf8')
  } catch {
    return ''
  }
}

// ---------------------------------------------------------------------------
// Memory Context Section (for LLM prompt injection)
// ---------------------------------------------------------------------------

export async function buildMemoryContextSection(): Promise<string> {
  const [
    scratchpad,
    identity,
    dialogueBlocks,
    patterns,
    bible,
    architecture,
    repoGuide,
  ] = await Promise.all([
    loadScratchpad(),
    loadIdentity(),
    loadDialogueBlocks(),
    loadPatterns(),
    loadBible(),
    loadArchitecture(),
    loadRepoGuide(),
  ])

  const parts: string[] = []

  // Constitution (BIBLE.md) — always included, truncated if needed
  if (bible) {
    parts.push('## Constitution (BIBLE.md)\n')
    parts.push(bible.slice(0, 15000))
  }

  // Architecture — always included
  if (architecture) {
    parts.push('\n## Architecture (ARCHITECTURE.md)\n')
    parts.push(architecture.slice(0, 10000))
  }

  if (repoGuide) {
    parts.push('\n## Repository Guide (REPO_GUIDE.md)\n')
    parts.push(repoGuide.slice(0, 8000))
  }

  parts.push('\n## Scratchpad (working memory)\n')
  parts.push(scratchpad)

  parts.push('\n## Identity\n')
  parts.push(identity)

  if (dialogueBlocks.length > 0) {
    parts.push('\n## Recent dialogue memory\n')
    const recent = dialogueBlocks.slice(-3)
    for (const block of recent) {
      parts.push(`### ${block.range} (${block.type}, ${block.messageCount} msgs)\n`)
      parts.push(block.content.slice(0, 2000))
      parts.push('\n---\n')
    }
  }

  parts.push('\n## Pattern Register (recurring error classes)\n')
  parts.push(patterns)

  return parts.join('\n')
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

export async function ensureMemoryFiles(): Promise<void> {
  await mkdir(memoryDir(), { recursive: true })
  await mkdir(join(memoryDir(), 'knowledge'), { recursive: true })

  // Create defaults if missing
  await loadScratchpad()
  await loadIdentity()
  const patterns = await loadPatterns()
  try {
    await readFile(patternsPath(), 'utf8')
  } catch {
    await savePatterns(patterns)
  }
}
