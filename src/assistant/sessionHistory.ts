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
    const cacheMsg: CacheMessage = {
      role: m.role,
      content:
        typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      tool_calls: m.tool_calls as CacheMessage['tool_calls'],
      tool_use_id: m.tool_use_id,
      timestamp: Date.now(),
    }
    if ('id' in m && m.id) cacheMsg.id = m.id
    if ('type' in m && m.type) cacheMsg.type = m.type
    if ('model' in m && m.model) cacheMsg.model = m.model
    if ('created_at' in m && m.created_at) cacheMsg.created_at = m.created_at
    if ('stop_reason' in m && m.stop_reason) cacheMsg.stop_reason = m.stop_reason
    if ('usage' in m && m.usage) cacheMsg.usage = m.usage as CacheMessage['usage']
    if ('is_development' in m) cacheMsg.is_development = m.is_development
    if ('index' in m && typeof m.index === 'number') cacheMsg.index = m.index
    return cacheMsg
  })
}

function deserializeFromCacheMessage(messages: CacheMessage[]): SDKMessage[] {
  return messages.map((m): SDKMessage => {
    // Reconstruct structured content from JSON string if needed
    let content: SDKMessage['content']
    try {
      content = typeof m.content === 'string' && m.content.startsWith('[')
        ? JSON.parse(m.content)
        : m.content
    } catch {
      content = m.content
    }
    
    const msg: SDKMessage = {
      role: m.role,
      content,
      tool_calls: m.tool_calls as SDKMessage['tool_calls'],
      tool_use_id: m.tool_use_id,
    }
    if (m.id) msg.id = m.id
    if (m.type) msg.type = m.type
    if (m.model) msg.model = m.model
    if (m.created_at) msg.created_at = m.created_at
    if (m.stop_reason) msg.stop_reason = m.stop_reason
    if (m.usage) msg.usage = m.usage as SDKMessage['usage']
    if (typeof m.is_development === 'boolean') msg.is_development = m.is_development
    if (typeof m.index === 'number') msg.index = m.index
    return msg
  })
}

export async function fetchLatestEvents(
  ctx: HistoryAuthCtx,
  limit = HISTORY_PAGE_SIZE,
): Promise<HistoryPage | null> {
  const sessionId = extractSessionId(ctx.baseUrl)

  // Try to fetch fresh data first - always return current data when API is reachable
  const page = await fetchPage(ctx, { limit, anchor_to_latest: true }, 'fetchLatestEvents')

  if (page && page.events.length > 0) {
    // Cache and persist the fetched events
    await cacheSession(sessionId, page.events)
    return page
  }

  // If API fetch failed or returned empty, fall back to cached data if available
  const cached = await loadCachedSession(sessionId)
  if (cached && cached.length > 0) {
    return {
      events: cached,
      firstId: cached[0]?.id ?? null,
      hasMore: true,
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

// Track last saved event count to avoid unnecessary disk writes
const lastSavedCounts = new Map<string, number>()
const lastSavedIds = new Map<string, Set<string>>()

export async function cacheSession(
  sessionId: string,
  events: SDKMessage[],
): Promise<void> {
  const cache = getHistoryCache()
  const messages = serializeToCacheMessage(events)
  cache.set(sessionId, messages)

  // Check for meaningful change: new message IDs or count change
  const newIds = new Set(events.map(e => e.id))
  const lastIds = lastSavedIds.get(sessionId)
  const newCount = events.length
  const lastCount = lastSavedCounts.get(sessionId) ?? 0
  
  // Persist if: count changed OR new event IDs (meaningful change)
  const hasNewIds = !lastIds || [...newIds].some(id => !lastIds.has(id))
  if (hasNewIds || newCount !== lastCount) {
    lastSavedCounts.set(sessionId, newCount)
    lastSavedIds.set(sessionId, newIds)
    
    const session = createSession(
      messages as never,
      { model: process.env.OPENAI_MODEL },
    )
    session.id = sessionId
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
      return deserializeFromCacheMessage(events)
    }
  } catch {
    // Session not found or corrupt
  }

  return null
}