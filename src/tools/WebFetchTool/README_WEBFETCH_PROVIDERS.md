# WebFetch Providers

OpenClaude supports multiple fetch backends through a provider adapter system.

## Supported Providers

| Provider | Env Var | Auth Header | Method |
|---|---|---|---|
| Default (axios) | *(always)* | — | Direct HTTP |
| Jina Reader | `JINA_API_KEY` *(optional)* | `Authorization: Bearer` | GET |
| Jina Reader Pro | `JINA_API_KEY` | `Authorization: Bearer` | GET |
| Firecrawl | `FIRECRAWL_API_KEY` | Internal SDK | SDK |
| Tavily | `TAVILY_API_KEY` | `Authorization: Bearer` | POST |
| Exa | `EXA_API_KEY` | `x-api-key` | POST |
| Bing | `BING_API_KEY` | `Ocp-Apim-Subscription-Key` | GET |
| Brave | `WEB_KEY` + `WEB_PROVIDER=brave` | `X-Subscription-Token` | GET |
| You.com | `YOU_API_KEY` | `X-API-Key` | GET |
| Mojeek | `MOJEEK_API_KEY` | `Authorization: Bearer` | GET |
| Linkup | `LINKUP_API_KEY` | `Authorization: Bearer` | POST |
| DuckDuckGo | *(default)* | — | SDK |
| Custom API | `WEB_FETCH_API` | Configurable | GET/POST |

## Quick Start

```bash
# Jina Reader (free, no key needed — recommended)
export WEB_FETCH_PROVIDER=jina

# Firecrawl (best for JS-heavy sites)
export FIRECRAWL_API_KEY=fc-your-key
export WEB_FETCH_PROVIDER=firecrawl

# Tavily Extract
export TAVILY_API_KEY=tvly-your-key
export WEB_FETCH_PROVIDER=tavily

# Exa Contents
export EXA_API_KEY=your-exa-key
export WEB_FETCH_PROVIDER=exa

# Custom endpoint
export WEB_FETCH_API="https://my-scraper.example.com/fetch?url={url}"
export WEB_FETCH_PROVIDER=custom

# Auto mode (default) — tries all configured in priority order
# No configuration needed
```

## Provider Selection Mode

`WEB_FETCH_PROVIDER` controls fallback behavior:

| Mode | Behavior |
|---|---|
| `auto` (default) | Try all configured providers in priority order, fall through on failure |
| `default` | Direct HTTP fetch only |
| `jina` | Jina Reader only — throws on failure |
| `jina-reader` | Jina Reader Pro only — throws on failure |
| `firecrawl` | Firecrawl only — throws on failure |
| `tavily` | Tavily Extract only — throws on failure |
| `exa` | Exa Contents only — throws on failure |
| `bing` | Bing search extract only — throws on failure |
| `brave` | Brave search extract only — throws on failure |
| `you` | You.com extract only — throws on failure |
| `mojeek` | Mojeek extract only — throws on failure |
| `linkup` | Linkup extract only — throws on failure |
| `ddg` | DuckDuckGo extract only — throws on failure |
| `custom` | Custom API only — throws on failure |

**Auto mode priority:** firecrawl → tavily → exa → jina → jina-reader → bing → brave → you → mojeek → linkup → ddg → default

> **Note:** Custom is excluded from the auto chain. It must be explicitly selected via `WEB_FETCH_PROVIDER=custom`.

## Provider Details

### Default (axios)

Always available. Direct HTTP fetching with HTML→Markdown, redirect handling, retry.

### Jina Reader

Free URL→markdown. No API key needed (rate-limited). `r.jina.ai` endpoint.

### Jina Reader Pro

Structured JSON output via `s.jina.ai`. Requires `JINA_API_KEY`.

### Firecrawl

JS rendering, anti-bot detection. `FIRECRAWL_API_KEY`.

### Tavily Extract

AI-optimized content extraction. `TAVILY_API_KEY`.

### Exa Contents

Neural content extraction. `EXA_API_KEY`.

### Bing, Brave, You.com, Mojeek, Linkup, DuckDuckGo

Search-based content extraction. Use their search APIs with `site:` prefix to extract page content.

### Custom

User-configured HTTP endpoint. `WEB_FETCH_API` with `{url}` placeholder.

#### Security Guardrails

| Guardrail | Default | Override |
|-----------|---------|----------|
| HTTPS-only | ✅ | `WEB_FETCH_CUSTOM_ALLOW_HTTP=true` |
| Block private IPs | ✅ | `WEB_FETCH_CUSTOM_ALLOW_PRIVATE=true` |
| Request timeout | 30s | `WEB_FETCH_CUSTOM_TIMEOUT_SEC=<seconds>` |

## Comparison with WebSearch Providers

| Feature | WebSearch | WebFetch |
|---|---|---|
| Providers | 14 | 13 |
| Auto fallback | ✅ | ✅ |
| Config var | `WEB_SEARCH_PROVIDER` | `WEB_FETCH_PROVIDER` |
| Custom excluded from auto | ✅ | ✅ |

## Adding a Provider

1. Create `providers/myprovider.ts`:

```typescript
import type { FetchProvider, FetchResult, RedirectInfo } from './types.js'

export const myProvider: FetchProvider = {
  name: 'myprovider',
  isConfigured() { return Boolean(process.env.MYPROVIDER_API_KEY) },
  async fetch(url: string, signal?: AbortSignal): Promise<FetchResult | RedirectInfo> {
    // ... call API, return FetchResult ...
    return { content, bytes, code: 200, codeText: 'OK', contentType: 'text/markdown' }
  },
}
```

2. Register in `providers/index.ts` — add import and push to `ALL_PROVIDERS`.
