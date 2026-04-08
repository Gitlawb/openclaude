# Web Search Tool — Providers & Custom API Support

## Architecture

Search backends are implemented as **provider adapters**, each with a common interface:

```
src/tools/WebSearchTool/
├── providers/
│   ├── types.ts          — SearchProvider interface, shared types
│   ├── duckduckgo.ts     — DuckDuckGo adapter
│   ├── firecrawl.ts      — Firecrawl adapter
│   ├── custom.ts         — Custom API adapter (supports all backends)
│   └── index.ts          — Provider registry, selection, fallback logic
├── WebSearchTool.ts      — Tool definition, shared formatting
├── prompt.ts             — (unchanged)
└── UI.tsx                — (unchanged)
```

Each adapter implements:
- `isConfigured()` — returns true when required env vars are present
- `search(input)` — performs the search, returns normalized `SearchHit[]`
- `name` — human-readable label for logging / tool_use_id

**Shared logic** (domain filtering, snippet formatting, result-block construction) lives in the tool layer, not in adapters.

---

## Provider Selection

`WEB_SEARCH_PROVIDER` controls which backend to use:

| Mode | Behavior |
|---|---|
| `auto` (default) | Try providers in order, fall through on failure |
| `custom` | Use custom API only — throw on failure |
| `firecrawl` | Use Firecrawl only — throw on failure |
| `ddg` | Use DuckDuckGo only — throw on failure |
| `native` | Use Anthropic native / Codex only — throw on failure |

**Fallback semantics:**
- `auto` mode is the **only** mode that silently falls through to the next provider
- All specific modes **fail loudly** — no silent backend switching

---

## Quick Start

### Built-in Providers

```bash
# SearXNG (self-hosted, no key)
export WEB_PROVIDER=searxng
export WEB_SEARCH_API="https://search.example.com/search"  # optional override

# Google Custom Search
export WEB_PROVIDER=google
export WEB_KEY="YOUR_GOOGLE_API_KEY"

# Brave Search
export WEB_PROVIDER=brave
export WEB_KEY="YOUR_BRAVE_API_KEY"

# SerpAPI
export WEB_PROVIDER=serpapi
export WEB_KEY="YOUR_SERPAPI_KEY"
```

| Preset | Default URL | Auth Header |
|---|---|---|
| `searxng` | `http://localhost:8080/search` | *(none)* |
| `google` | `https://www.googleapis.com/customsearch/v1` | `Authorization: Bearer` |
| `brave` | `https://api.search.brave.com/res/v1/web/search` | `X-Subscription-Token` |
| `serpapi` | `https://serpapi.com/search.json` | `Authorization: Bearer` |

### Custom Endpoint

```bash
export WEB_SEARCH_API="https://my-search-api.com/v2/search"
export WEB_KEY="my-secret-key"
export WEB_PARMS="query"
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `WEB_SEARCH_PROVIDER` | `auto` | Provider selection mode |
| `WEB_SEARCH_API` | — | Base URL of your search endpoint |
| `WEB_PROVIDER` | — | Built-in preset name |
| `WEB_KEY` | — | API key (sent in headers, **never** in query string) |
| `WEB_PARMS` | `q` | Query parameter name |
| `WEB_METHOD` | `GET` | HTTP method (`GET` or `POST`) |
| `WEB_URL_TEMPLATE` | — | URL template with `{query}` for path embedding |
| `WEB_PARAMS` | — | Extra static query params as JSON |
| `WEB_BODY_TEMPLATE` | — | Custom POST body with `{query}` placeholder |
| `WEB_AUTH_HEADER` | `Authorization` | Header name for the API key |
| `WEB_AUTH_SCHEME` | `Bearer` | Prefix before the key |
| `WEB_HEADERS` | — | Extra headers as `"Name: value; Name2: value2"` |
| `WEB_JSON_PATH` | — | Dot-path to the results array in response JSON |

---

## Request Construction

### Mode 1: Standard Param (default)

```
GET https://api.example.com/search?q=hello
Authorization: Bearer <key>
```

### Mode 2: Query in URL Path

```
GET https://api.example.com/v2/search/hello/results
```

```bash
export WEB_URL_TEMPLATE="https://api.example.com/v2/search/{query}/results"
```

### Mode 3: POST with Custom Body

```
POST https://api.example.com/v1/query
Content-Type: application/json
Authorization: Bearer <key>

{"input": {"text": "hello", "lang": "en"}, "options": {"max_results": 20}}
```

```bash
export WEB_METHOD=POST
export WEB_BODY_TEMPLATE='{"input":{"text":"{query}","lang":"en"},"options":{"max_results":20}}'
```

### Mode 4: Extra Static Params

```bash
export WEB_PARAMS='{"lang":"en","format":"json","count":"10"}'
```

Merged into the URL query string alongside the search param.

---

## Auth — Headers, Never Query Strings

API keys are always sent in HTTP headers, **never** in the URL.

| Config | Result |
|---|---|
| Default | `Authorization: Bearer <key>` |
| `WEB_AUTH_HEADER=X-Api-Key` | `X-Api-Key: Bearer <key>` |
| `WEB_AUTH_SCHEME=""` | `Authorization: <key>` |
| `WEB_AUTH_HEADER=X-Api-Key WEB_AUTH_SCHEME=""` | `X-Api-Key: <key>` |

---

## Response Parsing — Flexible

Auto-detects many common response shapes:

### Supported Formats

```jsonc
// Nested map (original format)
{ "results": { "engine_name": [{ "title": "...", "url": "..." }] } }

// Flat array under common keys
{ "results": [{ "title": "...", "url": "..." }] }
{ "items": [{ "title": "...", "link": "..." }] }
{ "data": [{ "name": "...", "href": "..." }] }
{ "hits": [{ "headline": "...", "uri": "..." }] }

// Bare array
[{ "title": "...", "url": "..." }]

// Deeply nested — use WEB_JSON_PATH
{ "data": { "search": { "results": [...] } } }
```

### Field Name Aliases

| Field | Accepted Names |
|---|---|
| Title | `title`, `headline`, `name`, `heading` |
| URL | `url`, `link`, `href`, `uri`, `permalink` |
| Description | `description`, `snippet`, `content`, `preview`, `summary`, `text`, `body` |
| Source | `source`, `domain`, `displayLink`, `displayed_link`, `engine` |

---

## Retry & Fallback

### Automatic Retry

If a request fails (network error, 5xx), it is **automatically retried once** after a 500ms delay. Client errors (4xx) are not retried.

### Graceful Fallback (auto mode only)

**Priority chain:** Custom API → Firecrawl → DuckDuckGo → Codex → Native Anthropic

In `auto` mode, failures log an error and try the next provider. In specific modes, the provider throws immediately on failure.

---

## Adding a New Provider

1. Create `providers/myprovider.ts`:

```typescript
import type { SearchInput, SearchProvider } from './types.js'
import { applyDomainFilters, type ProviderOutput } from './types.js'

export const myProvider: SearchProvider = {
  name: 'myprovider',

  isConfigured() {
    return Boolean(process.env.MYPROVIDER_API_KEY)
  },

  async search(input: SearchInput): Promise<ProviderOutput> {
    const start = performance.now()
    // ... call API, extract hits ...
    const hits = applyDomainFilters(rawHits, input)
    return {
      hits,
      providerName: 'myprovider',
      durationSeconds: (performance.now() - start) / 1000,
    }
  },
}
```

2. Add it to `providers/index.ts`:

```typescript
import { myProvider } from './myprovider.js'

const ALL_PROVIDERS: SearchProvider[] = [
  customProvider,
  firecrawlProvider,
  duckduckgoProvider,
  myProvider, // ← add here
]
```

3. Update `PROVIDER_BY_NAME` and `ProviderMode` type in `index.ts`.

That's it — no changes needed in `WebSearchTool.ts`.

---

## Existing Providers (unchanged)

| Provider | Env Var | Notes |
|---|---|---|
| DuckDuckGo | *(default)* | Free, no API key needed, rate-limited |
| Firecrawl | `FIRECRAWL_API_KEY` | Premium, reliable |
| Native Anthropic | *(firstParty/vertex)* | Requires Anthropic API, US only |
| Codex/OpenAI | `OPENAI_BASE_URL` + `CODEX_API_KEY` | OpenAI responses backend |
