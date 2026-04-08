/** Exa Contents — neural content extraction. EXA_API_KEY */
import type { FetchProvider, FetchResult, RedirectInfo } from './types.js'
export const exaProvider: FetchProvider = {
  name: 'exa',
  isConfigured() { return Boolean(process.env.EXA_API_KEY) },
  async fetch(url: string, signal?: AbortSignal): Promise<FetchResult | RedirectInfo> {
    const r = await fetch('https://api.exa.ai/contents', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.EXA_API_KEY! },
      body: JSON.stringify({ urls: [url], text: true }), signal,
    })
    if (!r.ok) throw new Error(`Exa contents error ${r.status}: ${await r.text().catch(() => '')}`)
    const data = await r.json()
    const content = data.results?.[0]?.text ?? data.results?.[0]?.extract ?? ''
    return { content, bytes: Buffer.byteLength(content), code: 200, codeText: 'OK', contentType: 'text/plain' }
  },
}
