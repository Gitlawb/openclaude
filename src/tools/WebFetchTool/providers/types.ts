export interface FetchResult {
  content: string
  bytes: number
  code: number
  codeText: string
  contentType: string
  persistedPath?: string
  persistedSize?: number
}

export interface RedirectInfo {
  type: 'redirect'
  originalUrl: string
  redirectUrl: string
  statusCode: number
}

export interface FetchProvider {
  readonly name: string
  isConfigured(): boolean
  fetch(url: string, signal?: AbortSignal): Promise<FetchResult | RedirectInfo>
}

export type ProviderMode =
  | 'auto'
  | 'default'
  | 'firecrawl'
  | 'tavily'
  | 'exa'
  | 'jina'
  | 'jina-reader'
  | 'bing'
  | 'brave'
  | 'you'
  | 'mojeek'
  | 'linkup'
  | 'ddg'
  | 'custom'
