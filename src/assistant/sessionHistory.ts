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
  const match = baseUrl.split('/v1/sessions/')[1]
  return match ? match.split('/')[0] : 'default'
}

function serializeToCacheMessage(events: SDKMessage[]): CacheMessage[] {
  return events.map((m): CacheMessage => ({
    role: m.role,
    content:
      typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    tool_calls: m.tool_calls as CacheMessage['tool_calls'],
    tool_use_id: m.tool_use_id,
  }))
}

function deserializeFromCacheMessage(messages: CacheMessage[]): SDKMessage[] {
  return messages.map((m): SDKMessage => ({
    role: m.role,
    content: m.content,
    tool_calls: m.tool_calls as SDKMessage['tool_calls'],
    tool_use_id: m.tool_use_id,
  }))
}

export async function fetchLatestEvents(
  ctx: HistoryAuthCtx,
  limit = HISTORY_PAGE_SIZE,
): Promise<HistoryPage | null> {
  const page = await fetchPage(ctx, { limit, anchor_to_latest: true }, 'fetchLatestEvents')

  if (page && page.events.length > 0) {
    const cache = getHistoryCache()
    const sessionId = extractSessionId(ctx.baseUrl)
    const cacheMessages = serializeToCacheMessage(page.events)
    cache.set(sessionId, cacheMessages)
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

export async function cacheSession(
  sessionId: string,
  events: SDKMessage[],
): Promise<void> {
  const cache = getHistoryCache()
  const messages = serializeToCacheMessage(events)
  cache.set(sessionId, messages)

  const session = createSession(
    messages as any,
    { model: process.env.OPENAI_MODEL },
  )
  session.id = sessionId
  await saveSession(session)
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

export async function listPersistedSessions() {
  return listSessions()
}