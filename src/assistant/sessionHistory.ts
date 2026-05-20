import axios from 'axios'
import { getOauthConfig } from '../constants/oauth.js'
import type { SDKMessage } from '../entrypoints/agentSdkTypes.js'
import { logForDebugging } from '../utils/debug.js'
import { getOAuthHeaders, prepareApiRequest } from '../utils/teleport/api.js'
import {
  ConversationCache,
  createConversationCache,
  type CacheMessage,
} from '../utils/conversationCache.js'
import {
  saveSession,
  loadSession,
  listSessions,
  createSession,
} from '../utils/sessionPersistence.js'

export const HISTORY_PAGE_SIZE = 100

// Module-level cache for session history
let historyCache: ConversationCache | undefined

function getHistoryCache(): ConversationCache {
  if (!historyCache) {
    historyCache = createConversationCache({
      maxSize: 50,
      ttlMs: 60 * 60 * 1000, // 1 hour
    })
  }
  return historyCache
}

export type HistoryPage = {
  events: SDKMessage[]
  firstId: string | null
  hasMore: boolean
}

type SessionEventsResponse = {
  data: SDKMessage[]
  has_more: boolean
  first_id: string | null
  last_id: string | null
}

export type HistoryAuthCtx = {
  baseUrl: string
  headers: Record<string, string>
}

export async function createHistoryAuthCtx(
  sessionId: string,
): Promise<HistoryAuthCtx> {
  const { accessToken, orgUUID } = await prepareApiRequest()
  return {
    baseUrl: `${getOauthConfig().BASE_API_URL}/v1/sessions/${sessionId}/events`,
    headers: {
      ...getOAuthHeaders(accessToken),
      'anthropic-beta': 'ccr-byoc-2025-07-29',
      'x-organization-uuid': orgUUID,
    },
  }
}

async function fetchPage(
  ctx: HistoryAuthCtx,
  params: Record<string, string | number | boolean>,
  label: string,
): Promise<HistoryPage | null> {
  const resp = await axios
    .get<SessionEventsResponse>(ctx.baseUrl, {
      headers: ctx.headers,
      params,
      timeout: 15000,
      validateStatus: () => true,
    })
    .catch(() => null)
  if (!resp || resp.status !== 200) {
    logForDebugging(`[${label}] HTTP ${resp?.status ?? 'error'}`)
    return null
  }
  return {
    events: Array.isArray(resp.data.data) ? resp.data.data : [],
    firstId: resp.data.first_id,
    hasMore: resp.data.has_more,
  }
}

function extractSessionId(baseUrl: string): string {
  // More robust extraction - handle various URL formats
  const match = baseUrl.match(/\/v1\/sessions\/([^/]+)/)
  return match ? match[1] : 'default'
}

function serializeToCacheMessage(events: SDKMessage[]): CacheMessage[] {
  return events.map((m): CacheMessage => {
    const isArrayContent = Array.isArray(m.content)
    const cacheMsg: CacheMessage = {
      role: m.role,
      content:
        typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      contentIsArray: isArrayContent,
      tool_calls: m.tool_calls as CacheMessage['tool_calls'],
      tool_use_id: m.tool_use_id,
      timestamp: Date.now(),
    }
    // Core SDK fields (always present)
    if ('id' in m && m.id) cacheMsg.id = m.id
    if ('type' in m) cacheMsg.type = m.type
    // Assistant message payload
    if ('message' in m) cacheMsg.message = m.message as CacheMessage['message']
    // Assistant error (SDKAssistantMessage only)
    if ('error' in m) cacheMsg.error = m.error as string
    // User message fields
    if ('uuid' in m) cacheMsg.uuid = m.uuid
    if ('session_id' in m) cacheMsg.session_id = m.session_id
    if ('parent_tool_use_id' in m) cacheMsg.parent_tool_use_id = m.parent_tool_use_id
    if ('tool_use_result' in m) cacheMsg.tool_use_result = m.tool_use_result as CacheMessage['tool_use_result']
    // Assistant message metadata
    if ('model' in m && m.model) cacheMsg.model = m.model
    if ('created_at' in m && m.created_at) cacheMsg.created_at = m.created_at
    if ('stop_reason' in m && m.stop_reason) cacheMsg.stop_reason = m.stop_reason
    if ('usage' in m && m.usage) cacheMsg.usage = m.usage as CacheMessage['usage']
    // Result/system fields
    if ('subtype' in m) cacheMsg.subtype = m.subtype
    if ('result' in m) cacheMsg.result = m.result as CacheMessage['result']
    // Result errors (SDKResultMessage error variant only)
    if ('errors' in m) cacheMsg.errors = m.errors as string[]
    // Stream event payload
    if ('event' in m) cacheMsg.event = m.event as CacheMessage['event']
    // Generic metadata
    if ('is_development' in m) cacheMsg.is_development = m.is_development
    if ('index' in m && typeof m.index === 'number') cacheMsg.index = m.index
    // System status (SDKStatusMessage only - persist 'compacting', skip null)
    if ('status' in m && m.status) cacheMsg.status = m.status as string
    // Compact boundary metadata (SDKCompactBoundaryMessage only)
    if ('compact_metadata' in m) cacheMsg.compact_metadata = m.compact_metadata as unknown
    // Tool progress fields (SDKToolProgressMessage only)
    if ('tool_name' in m) cacheMsg.tool_name = m.tool_name as string
    if ('elapsed_time_seconds' in m) cacheMsg.elapsed_time_seconds = m.elapsed_time_seconds as number
    return cacheMsg
  })
}

function deserializeFromCacheMessage(messages: CacheMessage[]): SDKMessage[] {
  return messages.map((m): SDKMessage => {
    let content: SDKMessage['content']
    if (m.contentIsArray) {
      try {
        content = JSON.parse(m.content)
      } catch {
        content = m.content
      }
    } else {
      content = m.content
    }

    const msg: SDKMessage = {
      role: m.role,
      content,
      tool_calls: m.tool_calls as SDKMessage['tool_calls'],
      tool_use_id: m.tool_use_id,
    }
    // Restore all SDK fields
    if (m.id) msg.id = m.id
    if (m.type) msg.type = m.type
    if (m.message) msg.message = m.message as SDKMessage['message']
    if (m.uuid) msg.uuid = m.uuid
    if (m.session_id) msg.session_id = m.session_id
    if (m.parent_tool_use_id) msg.parent_tool_use_id = m.parent_tool_use_id
    if (m.tool_use_result) msg.tool_use_result = m.tool_use_result as SDKMessage['tool_use_result']
    if (m.model) msg.model = m.model
    if (m.created_at) msg.created_at = m.created_at
    if (m.stop_reason) msg.stop_reason = m.stop_reason
    if (m.usage) msg.usage = m.usage as SDKMessage['usage']
    if (m.subtype) msg.subtype = m.subtype
    if (m.result) msg.result = m.result as SDKMessage['result']
    if (m.event) msg.event = m.event as SDKMessage['event']
    if (typeof m.is_development === 'boolean') msg.is_development = m.is_development
    if (typeof m.index === 'number') msg.index = m.index
    // Assistant error (SDKAssistantMessage)
    if (m.error) msg.error = m.error as SDKMessage['error']
    // Result errors (SDKResultMessage error variant)
    if (m.errors) msg.errors = m.errors as SDKMessage['errors']
    // System status (SDKStatusMessage - only truthy values get serialized)
    if (m.status) msg.status = m.status as SDKMessage['status']
    // Compact boundary metadata (SDKCompactBoundaryMessage)
    if (m.compact_metadata) msg.compact_metadata = m.compact_metadata as SDKMessage['compact_metadata']
    // Tool progress fields (SDKToolProgressMessage)
    if (m.tool_name) msg.tool_name = m.tool_name as SDKMessage['tool_name']
    if (m.elapsed_time_seconds !== undefined) msg.elapsed_time_seconds = m.elapsed_time_seconds as SDKMessage['elapsed_time_seconds']
    return msg
  })
}

export async function fetchLatestEvents(
  ctx: HistoryAuthCtx,
  limit = HISTORY_PAGE_SIZE,
): Promise<HistoryPage | null> {
  const sessionId = extractSessionId(ctx.baseUrl)

  const page = await fetchPage(ctx, { limit, anchor_to_latest: true }, 'fetchLatestEvents')

  if (page && page.events.length > 0) {
    await cacheSession(sessionId, page.events, page.hasMore, page.firstId)
    return page
  }

  const cached = await loadCachedSession(sessionId)
  if (cached && cached.length > 0) {
    const metadata = getSessionCacheMetadata(sessionId)
    return {
      events: cached,
      firstId: metadata?.lastId ?? null,
      hasMore: metadata?.hasMore ?? false,
    }
  }

  return page
}

export async function fetchOlderEvents(
  ctx: HistoryAuthCtx,
  beforeId: string,
  limit = HISTORY_PAGE_SIZE,
): Promise<HistoryPage | null> {
  return fetchPage(ctx, { limit, before_id: beforeId }, 'fetchOlderEvents')
}

const lastSavedCounts = new Map<string, number>()
const lastSavedIds = new Map<string, Set<string>>()
const sessionMetadataCache = new Map<string, { hasMore: boolean; lastId: string | null }>()

export async function cacheSession(
  sessionId: string,
  events: SDKMessage[],
  hasMore = false,
  lastId: string | null = null,
): Promise<void> {
  const cache = getHistoryCache()
  const messages = serializeToCacheMessage(events)
  cache.set(sessionId, messages)

  sessionMetadataCache.set(sessionId, { hasMore, lastId })

  const newUuids = new Set(events.map(e => e.uuid))
  const lastUuids = lastSavedIds.get(sessionId)
  const newCount = events.length
  const lastCount = lastSavedCounts.get(sessionId) ?? 0

  const hasNewUuids = !lastUuids || [...newUuids].some(uuid => !lastUuids.has(uuid))
  if (hasNewUuids || newCount !== lastCount) {
    lastSavedCounts.set(sessionId, newCount)
    lastSavedIds.set(sessionId, newUuids)

    const session = createSession(
      messages as never,
      { model: process.env.OPENAI_MODEL },
    )
    session.id = sessionId
    session.pagination = { hasMore, lastId }
    await saveSession(session)
  }
}

export async function loadCachedSession(
  sessionId: string,
): Promise<SDKMessage[] | null> {
  const cache = getHistoryCache()
  const cached = cache.get(sessionId)
  if (cached) {
    return deserializeFromCacheMessage(cached)
  }

  try {
    const session = await loadSession(sessionId)
    if (session) {
      const events = session.messages as CacheMessage[]
      cache.set(sessionId, events)

      if (session.pagination) {
        sessionMetadataCache.set(sessionId, {
          hasMore: session.pagination.hasMore,
          lastId: session.pagination.lastId,
        })
      }

      return deserializeFromCacheMessage(events)
    }
  } catch {
    // Session not found or corrupt
  }

  return null
}

export function getSessionCacheMetadata(
  sessionId: string,
): { hasMore: boolean; lastId: string | null } | undefined {
  return sessionMetadataCache.get(sessionId)
}