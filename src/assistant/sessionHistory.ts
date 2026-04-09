// Stub: assistant session history not available in Forge builds

export const HISTORY_PAGE_SIZE = 100

export type HistoryPage = {
  events: unknown[]
  firstId: string | null
  hasMore: boolean
}

export type HistoryAuthCtx = {
  baseUrl: string
  headers: Record<string, string>
}

export async function createHistoryAuthCtx(): Promise<HistoryAuthCtx | null> {
  return null
}

export async function fetchLatestEvents(): Promise<HistoryPage> {
  return { events: [], firstId: null, hasMore: false }
}

export async function fetchOlderEvents(): Promise<HistoryPage> {
  return { events: [], firstId: null, hasMore: false }
}
