/**
 * Local-only resume cache for prefix-cache listing attachments.
 *
 * External transcripts deliberately omit skill_listing / agent_listing_delta /
 * deferred_tools_delta / mcp_instructions_delta (privacy boundary — they carry
 * local skill descriptions, custom agent whenToUse/tool policy, and server
 * MCP InitializeResult.instructions). Without a separate store, --resume
 * rebuilds an empty announced set and re-injects those catalogs mid-history,
 * busting OpenAI/Moonshot automatic prefix cache.
 *
 * This file lives beside the session transcript (`{sessionId}.resume-cache.json`),
 * is never passed through cleanMessagesForLogging / sessionIngress, and holds
 * only what is needed to reinject turn-0-equivalent listing attachments into
 * the in-memory message list on resume (plus content hashes for stale detection).
 */
import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import {
  getOriginalCwd,
  getSessionId,
  getSessionProjectDir,
} from '../bootstrap/state.js'
import type { Message } from '../types/message.js'
import { createAttachmentMessage } from './attachments.js'
import { getProjectDir } from './cachePaths.js'
import { hashContent } from './hash.js'
import { jsonParse, jsonStringify } from './slowOperations.js'

export const RESUME_CACHE_VERSION = 1 as const

export type ResumeCacheSkillListing = {
  content: string
  skillCount: number
  isInitial: boolean
  contentHash: string
}

export type ResumeCacheAgentListing = {
  /** agentType → rendered formatAgentLine */
  lines: Record<string, string>
  showConcurrencyNote: boolean
}

export type ResumeCacheDeferredTools = {
  /** tool name → rendered listing line */
  lines: Record<string, string>
}

export type ResumeCacheMcpInstructions = {
  /** server name → rendered instruction block */
  blocks: Record<string, string>
}

export type ResumeCache = {
  version: typeof RESUME_CACHE_VERSION
  skillListings: ResumeCacheSkillListing[]
  agentListing?: ResumeCacheAgentListing
  deferredTools?: ResumeCacheDeferredTools
  mcpInstructions?: ResumeCacheMcpInstructions
}

const EMPTY_CACHE = (): ResumeCache => ({
  version: RESUME_CACHE_VERSION,
  skillListings: [],
})

/** In-memory mirror so incremental recordTranscript slices merge without reread races. */
let memoryCache: ResumeCache | null = null
let memoryCacheSessionId: string | null = null
let writeChain: Promise<void> = Promise.resolve()

export function getResumeCachePath(
  sessionId: string = getSessionId(),
): string {
  const projectDir = getSessionProjectDir() ?? getProjectDir(getOriginalCwd())
  return join(projectDir, `${sessionId}.resume-cache.json`)
}

function resetMemoryIfSessionChanged(sessionId: string): void {
  if (memoryCacheSessionId !== sessionId) {
    memoryCache = null
    memoryCacheSessionId = sessionId
  }
}

function isResumeCache(value: unknown): value is ResumeCache {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return v.version === RESUME_CACHE_VERSION && Array.isArray(v.skillListings)
}

export async function loadResumeCache(
  sessionId: string = getSessionId(),
): Promise<ResumeCache> {
  resetMemoryIfSessionChanged(sessionId)
  if (memoryCache) return memoryCache
  try {
    const raw = await readFile(getResumeCachePath(sessionId), 'utf8')
    const parsed: unknown = jsonParse(raw)
    if (isResumeCache(parsed)) {
      memoryCache = parsed
      return parsed
    }
  } catch {
    // missing / corrupt → empty
  }
  memoryCache = EMPTY_CACHE()
  return memoryCache
}

function scheduleSave(sessionId: string, cache: ResumeCache): void {
  memoryCache = cache
  memoryCacheSessionId = sessionId
  const path = getResumeCachePath(sessionId)
  const body = jsonStringify(cache)
  writeChain = writeChain
    .then(async () => {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 })
      await writeFile(path, body, { encoding: 'utf8', mode: 0o600 })
    })
    .catch(() => {
      // Best-effort: prefix-cache miss is preferable to crashing the turn.
    })
}

/** Test helper — drop in-memory state between cases. */
export function resetResumeCacheForTesting(): void {
  memoryCache = null
  memoryCacheSessionId = null
}

function hasListingAttachment(messages: Message[]): boolean {
  for (const m of messages) {
    if (m.type !== 'attachment') continue
    // Legacy transcripts may carry malformed attachment records (null/undefined
    // attachment payload). Skip those instead of throwing during resume.
    if (!m.attachment || typeof m.attachment !== 'object') continue
    const t = m.attachment.type
    if (
      t === 'skill_listing' ||
      t === 'agent_listing_delta' ||
      t === 'deferred_tools_delta' ||
      t === 'mcp_instructions_delta'
    ) {
      return true
    }
  }
  return false
}

/**
 * Merge listing attachments from a transcript write slice into the local
 * resume-cache. Called with the FULL (pre-filter) message list so external
 * sessions still persist announced catalogs without writing them to the
 * public transcript.
 */
export function updateResumeCacheFromMessages(
  messages: Message[],
  sessionId: string = getSessionId(),
): void {
  resetMemoryIfSessionChanged(sessionId)
  const cache = memoryCache ?? EMPTY_CACHE()
  let dirty = false

  for (const m of messages) {
    if (m.type !== 'attachment') continue
    // Legacy transcripts may carry malformed attachment records
    // (null/undefined payload). Skip those instead of throwing during
    // recordTranscript → updateResumeCacheFromMessages.
    if (!m.attachment || typeof m.attachment !== 'object') continue
    const a = m.attachment
    switch (a.type) {
      case 'skill_listing': {
        if (!a.content) break
        const contentHash = hashContent(a.content)
        // recordTranscript may re-pass the same skill_listing on every write;
        // dedupe by contentHash so hydrate does not prepend duplicates and
        // bust the early API prefix this cache exists to keep stable.
        if (cache.skillListings.some(l => l.contentHash === contentHash)) break
        cache.skillListings.push({
          content: a.content,
          skillCount: a.skillCount,
          isInitial: a.isInitial,
          contentHash,
        })
        dirty = true
        break
      }
      case 'agent_listing_delta': {
        const lines = { ...(cache.agentListing?.lines ?? {}) }
        for (const t of a.removedTypes) delete lines[t]
        for (let i = 0; i < a.addedTypes.length; i++) {
          const type = a.addedTypes[i]
          const line = a.addedLines[i]
          if (type && line !== undefined) lines[type] = line
        }
        cache.agentListing = {
          lines,
          showConcurrencyNote: a.showConcurrencyNote,
        }
        dirty = true
        break
      }
      case 'deferred_tools_delta': {
        const lines = { ...(cache.deferredTools?.lines ?? {}) }
        for (const n of a.removedNames) delete lines[n]
        for (let i = 0; i < a.addedNames.length; i++) {
          const name = a.addedNames[i]
          const line = a.addedLines[i]
          if (name && line !== undefined) lines[name] = line
        }
        cache.deferredTools = { lines }
        dirty = true
        break
      }
      case 'mcp_instructions_delta': {
        const blocks = { ...(cache.mcpInstructions?.blocks ?? {}) }
        for (const n of a.removedNames) delete blocks[n]
        for (let i = 0; i < a.addedNames.length; i++) {
          const name = a.addedNames[i]
          const block = a.addedBlocks[i]
          if (name && block !== undefined) blocks[name] = block
        }
        cache.mcpInstructions = { blocks }
        dirty = true
        break
      }
    }
  }

  if (dirty) {
    scheduleSave(sessionId, cache)
  }
}

/**
 * If the loaded transcript has no listing attachments (external privacy
 * filter), reinject turn-0-equivalent attachments from the local resume-cache
 * so the API message prefix stays byte-stable and announced-set scans work.
 */
export async function hydrateListingAttachmentsFromResumeCache(
  messages: Message[],
  sessionId: string = getSessionId(),
): Promise<Message[]> {
  if (hasListingAttachment(messages)) {
    return messages
  }

  const cache = await loadResumeCache(sessionId)
  const injected: Message[] = []

  // Match turn-0 collection order in attachments.ts (deferred → agent → mcp → skill).
  if (cache.deferredTools && Object.keys(cache.deferredTools.lines).length > 0) {
    const names = Object.keys(cache.deferredTools.lines).sort()
    injected.push(
      createAttachmentMessage({
        type: 'deferred_tools_delta',
        addedNames: names,
        addedLines: names.map(n => cache.deferredTools!.lines[n]!),
        removedNames: [],
      }),
    )
  }

  if (cache.agentListing && Object.keys(cache.agentListing.lines).length > 0) {
    const types = Object.keys(cache.agentListing.lines).sort()
    injected.push(
      createAttachmentMessage({
        type: 'agent_listing_delta',
        addedTypes: types,
        addedLines: types.map(t => cache.agentListing!.lines[t]!),
        removedTypes: [],
        isInitial: true,
        showConcurrencyNote: cache.agentListing.showConcurrencyNote,
      }),
    )
  }

  if (
    cache.mcpInstructions &&
    Object.keys(cache.mcpInstructions.blocks).length > 0
  ) {
    const names = Object.keys(cache.mcpInstructions.blocks).sort()
    injected.push(
      createAttachmentMessage({
        type: 'mcp_instructions_delta',
        addedNames: names,
        addedBlocks: names.map(n => cache.mcpInstructions!.blocks[n]!),
        removedNames: [],
      }),
    )
  }

  for (const listing of cache.skillListings) {
    injected.push(
      createAttachmentMessage({
        type: 'skill_listing',
        content: listing.content,
        skillCount: listing.skillCount,
        isInitial: listing.isInitial,
      }),
    )
  }

  if (injected.length === 0) {
    return messages
  }

  // Prepend so normalizeAttachmentForAPI rebuilds the same early prefix the
  // original session sent before the first real user turn content.
  return [...injected, ...messages]
}
