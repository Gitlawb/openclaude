import axios from 'axios'
import { getOauthConfig } from '../constants/oauth.js'
import type { SDKMessage } from '../entrypoints/agentSdkTypes.js'
import { logForDebugging } from '../utils/debug.js'
import { getOAuthHeaders, prepareApiRequest } from '../utils/teleport/api.js'
import { ConversationCache, createConversationCache } from '../utils/conversationCache.js'
import { saveSession, loadSession, listSessions, createSession } from '../utils/sessionPersistence.js'

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
  /** Chronological order within the page. */
  events: SDKMessage[]
  /** Oldest event ID in this page → before_id cursor for next-older page. */
  firstId: string | null
  /** true = older events exist. */
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

/** Prepare auth + headers + base URL once, reuse across pages. */
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

/**
 * Newest page: last `limit` events, chronological, via anchor_to_latest.
 * has_more=true means older events exist.
 */
export async function fetchLatestEvents(
  ctx: HistoryAuthCtx,
  limit = HISTORY_PAGE_SIZE,
): Promise<HistoryPage | null> {
  return fetchPage(ctx, { limit, anchor_to_latest: true }, 'fetchLatestEvents')
}

/** Older page: events immediately before `beforeId` cursor. */
export async function fetchOlderEvents(
  ctx: HistoryAuthCtx,
  beforeId: string,
  limit = HISTORY_PAGE_SIZE,
): Promise<HistoryPage | null> {
  return fetchPage(ctx, { limit, before_id: beforeId }, 'fetchOlderEvents')
}

// ---------------------------------------------------------------------------
// Session persistence helpers using conversationCache + sessionPersistence
// ---------------------------------------------------------------------------

export async function cacheSession(
  sessionId: string,
  events: SDKMessage[],
): Promise<void> {
  const cache = getHistoryCache()
  const messages = events.map(m => ({
    role: m.role,
    content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    timestamp: Date.now(),
    tool_calls: m.tool_calls,
    tool_use_id: (m as any).tool_use_id,
  }))

  cache.set(sessionId, messages as any)

  // Also persist to disk for cross-device sync
  const session = createSession(
    messages as any,
    { model: process.env.OPENAI_MODEL },
  )
  session.id = sessionId
  await saveSession(session, true)
}

export async function loadCachedSession(
  sessionId: string,
): Promise<SDKMessage[] | null> {
  // Try cache first
  const cache = getHistoryCache()
  const cached = cache.get(sessionId)
  if (cached) {
    return cached as any
  }

  // Try disk
  try {
    const session = await loadSession(sessionId, true)
    if (session) {
      const events = session.messages.map(m => ({
        role: m.role,
        content: m.content,
        tool_calls: m.tool_calls,
        tool_use_id: m.tool_use_id,
      })) as any
      // Populate cache
      cache.set(sessionId, events)
      return events
    }
  } catch {
    // Session not found or corrupt
  }

  return null
}

export async function listPersistedSessions() {
  return listSessions()
}
