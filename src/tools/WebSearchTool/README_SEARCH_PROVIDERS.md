# Web Search Providers

OpenClaude supports multiple search backends through a provider adapter system.

## Supported Providers

| Provider | Env Var | Auth Header | Method |
|---|---|---|---|
| Custom API | `WEB_SEARCH_API` | Configurable | GET/POST |
| SearXNG | `WEB_PROVIDER=searxng` | — | GET |
| Google | `WEB_PROVIDER=google` | `Authorization: Bearer` | GET |
| Brave | `WEB_PROVIDER=brave` | `X-Subscription-Token` | GET |
| SerpAPI | `WEB_PROVIDER=serpapi` | `Authorization: Bearer` | GET |
| Firecrawl | `FIRECRAWL_API_KEY` | Internal | SDK |
| Tavily | `TAVILY_API_KEY` | `Authorization: Bearer` | POST |
| Exa | `EXA_API_KEY` | `x-api-key` | POST |
| You.com | `YOU_API_KEY` | `X-API-Key` | GET |
| Jina | `JINA_API_KEY` | `Authorization: Bearer` | GET |
| Bing | `BING_API_KEY` | `Ocp-Apim-Subscription-Key` | GET |
| Mojeek | `MOJEEK_API_KEY` | `Authorization: Bearer` | GET |
| Linkup | `LINKUP_API_KEY` | `Authorization: Bearer` | POST |
| DuckDuckGo | *(default)* | — | SDK |

## Quick Start

```bash
# Pick one provider and set its key:

# Tavily (recommended for AI — fast, RAG-ready)
export TAVILY_API_KEY=tvly-your-key

# Exa (neural search, great for semantic queries)
export EXA_API_KEY=your-exa-key

# Brave (traditional web search, good coverage)
export WEB_PROVIDER=brave
export WEB_KEY=your-brave-key

# Bing
export BING_API_KEY=your-bing-key

# Self-hosted SearXNG (free, private)
export WEB_PROVIDER=searxng
export WEB_SEARCH_API=https://search.example.com/search
```

## Provider Selection Mode

`WEB_SEARCH_PROVIDER` controls fallback behavior:

| Mode | Behavior |
|---|---|
| `auto` (default) | Try all configured providers in order, fall through on failure |
| `tavily` | Tavily only — throws on failure |
| `exa` | Exa only — throws on failure |
| `custom` | Custom API only — throws on failure |
| `firecrawl` | Firecrawl only — throws on failure |
| `ddg` | DuckDuckGo only — throws on failure |
| `native` | Anthropic native / Codex only |

**Auto mode priority:** custom → firecrawl → tavily → exa → you → jina → bing → mojeek → linkup → ddg

```bash
# Fail loudly if Tavily is down (don't silently switch backends)
export WEB_SEARCH_PROVIDER=tavily

# Try everything, fall through gracefully
export WEB_SEARCH_PROVIDER=auto
```

## Custom API Configuration

### Standard GET

```
GET https://api.example.com/search?q=hello
```

```bash
export WEB_SEARCH_API=https://api.example.com/search
export WEB_PARMS=q
```

### Query in URL Path

```
GET https://api.example.com/v2/search/hello
```

```bash
export WEB_URL_TEMPLATE=https://api.example.com/v2/search/{query}
```

### POST with Custom Body

```
POST https://api.example.com/v1/query
Content-Type: application/json

{"input": {"text": "hello"}}
```

```bash
export WEB_SEARCH_API=https://api.example.com/v1/query
export WEB_METHOD=POST
export WEB_BODY_TEMPLATE='{"input":{"text":"{query}"}}'
```

### Extra Static Params

```bash
export WEB_PARAMS='{"lang":"en","count":"10"}'
```

## Auth

API keys are sent in HTTP headers, **never** in query strings.

```bash
# Default: Authorization: Bearer <key>
export WEB_KEY=your-key

# Custom header
export WEB_AUTH_HEADER=X-Api-Key
export WEB_AUTH_SCHEME=""

# Extra headers
export WEB_HEADERS="X-Tenant: acme; Accept: application/json"
```

## Response Parsing

The tool auto-detects many response formats:

```jsonc
{ "results": [{ "title": "...", "url": "..." }] }     // flat array
{ "items": [{ "title": "...", "link": "..." }] }       // Google-style
{ "results": { "engine": [{ "title": "...", "url": "..." }] } }  // nested map
[{ "title": "...", "url": "..." }]                      // bare array
```

Field name aliases: `title`/`headline`/`name`, `url`/`link`/`href`, `description`/`snippet`/`content`

For deeply nested responses:
```bash
export WEB_JSON_PATH=response.payload.results
```

## Retry

Failed requests (network errors, 5xx) are retried once after 500ms. Client errors (4xx) are not retried.

## Adding a Provider

1. Create `providers/myprovider.ts`:

```typescript
import type { SearchInput, SearchProvider } from './types.js'
import { applyDomainFilters, type ProviderOutput } from './types.js'

export const myProvider: SearchProvider = {
  name: 'myprovider',
  isConfigured() { return Boolean(process.env.MYPROVIDER_API_KEY) },
  async search(input: SearchInput): Promise<ProviderOutput> {
    const start = performance.now()
    // ... call API, map to SearchHit[] ...
    return {
      hits: applyDomainFilters(hits, input),
      providerName: 'myprovider',
      durationSeconds: (performance.now() - start) / 1000,
    }
  },
}
```

2. Register in `providers/index.ts` — add import and push to `ALL_PROVIDERS`.
