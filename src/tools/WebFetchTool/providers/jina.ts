/**
 * Jina Reader WebFetch provider.
 *
 * Uses Jina Reader API (r.jina.ai) to fetch URLs and return clean markdown.
 * Jina handles JavaScript rendering, content extraction, and cleaning.
 *
 * Features:
 * - Free tier available (no API key needed for basic usage)
 * - Paid tier with higher rate limits (JINA_API_KEY)
 * - Returns clean markdown, no HTML conversion needed
 * - Handles JS-rendered pages
 *
 * Auth: JINA_API_KEY (optional — works without key at reduced rate)
 * Endpoint: GET https://r.jina.ai/{url}
 */

import type { FetchProvider, FetchResult, RedirectInfo } from './types.js'

export const jinaProvider: FetchProvider = {
  name: 'jina',

  isConfigured() {
    // Jina Reader works without an API key (rate-limited), so always available
    return true
  },

  async fetch(url: string, signal?: AbortSignal): Promise<FetchResult | RedirectInfo> {
    const jinaUrl = `https://r.jina.ai/${url}`

    const headers: Record<string, string> = {
      Accept: 'text/plain',
    }

    if (process.env.JINA_API_KEY) {
      headers['Authorization'] = `Bearer ${process.env.JINA_API_KEY}`
    }

    const res = await fetch(jinaUrl, { headers, signal })

    if (!res.ok) {
      throw new Error(`Jina Reader error ${res.status}: ${await res.text().catch(() => '')}`)
    }

    const content = await res.text()
    const contentType = res.headers.get('content-type') ?? 'text/markdown'

    return {
      content,
      bytes: Buffer.byteLength(content),
      code: res.status,
      codeText: res.statusText,
      contentType,
    }
  },
}
