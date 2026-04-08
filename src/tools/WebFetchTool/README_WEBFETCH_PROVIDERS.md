# WebFetch Providers

OpenClaude supports multiple fetch backends through a provider adapter system.

## Supported Providers

| Provider | Env Var | Auth | Notes |
|---|---|---|---|
| Default (axios) | *(always)* | — | Direct HTTP fetch, HTML→Markdown |
| Jina Reader | `JINA_API_KEY` *(optional)* | `Authorization: Bearer` | Free, clean markdown, JS rendering |
| Firecrawl | `FIRECRAWL_API_KEY` | Internal SDK | JS rendering, anti-bot |
| Custom API | `WEB_FETCH_API` | Configurable | User-configured HTTP endpoint |

## Quick Start

```bash
# Jina Reader (free, recommended — no API key needed)
export WEB_FETCH_PROVIDER=jina
# or just let auto mode find it (it's always available)

# Firecrawl (best for JS-heavy sites)
export FIRECRAWL_API_KEY=fc-your-key
export WEB_FETCH_PROVIDER=firecrawl

# Custom endpoint
export WEB_FETCH_API="https://my-scraper.example.com/fetch?url={url}"
export WEB_FETCH_PROVIDER=custom

# Auto mode (default) — tries: firecrawl → jina → default
# No configuration needed
```

## Provider Selection Mode

`WEB_FETCH_PROVIDER` controls fallback behavior:

| Mode | Behavior |
|---|---|
| `auto` (default) | Try all configured providers in order, fall through on failure |
| `default` | Direct HTTP fetch only |
| `jina` | Jina Reader only — throws on failure |
| `firecrawl` | Firecrawl only — throws on failure |
| `custom` | Custom API only — throws on failure |

**Auto mode priority:** firecrawl → jina → default

```bash
# Fail loudly if Firecrawl is down (don't silently switch backends)
export WEB_FETCH_PROVIDER=firecrawl

# Try everything, fall through gracefully
export WEB_FETCH_PROVIDER=auto
```

## Provider Details

### Default (axios)

Always available. Uses axios for direct HTTP fetching with:
- HTTP→HTTPS upgrade
- Same-host redirect following (www. variations, path changes)
- HTML→Markdown conversion via Turndown
- Domain blocklist preflight (firstParty API only)
- One retry on 5xx/network errors
- Binary content persistence (PDFs, images)

```bash
# No configuration needed — this is the fallback
export WEB_FETCH_PROVIDER=default
```

### Jina Reader

Free URL-to-markdown service. No API key needed for basic usage (rate-limited).
Paid tier with higher limits via `JINA_API_KEY`.

- Handles JavaScript-rendered pages
- Returns clean markdown directly (no HTML conversion needed)
- Fast — Jina's infrastructure handles anti-bot, rendering, extraction

```bash
# Free tier (rate-limited)
export WEB_FETCH_PROVIDER=jina

# Paid tier
export JINA_API_KEY=your-jina-key
export WEB_FETCH_PROVIDER=jina
```

**Request:**
```
GET https://r.jina.ai/{url}
Authorization: Bearer <key> (optional)
```

### Firecrawl

Uses the Firecrawl SDK. Best for heavily JavaScript-rendered pages and
sites with anti-bot protection.

```bash
export FIRECRAWL_API_KEY=fc-your-key
export WEB_FETCH_PROVIDER=firecrawl
```

### Custom API

Point WebFetch at your own HTTP endpoint. Useful for proxies, internal
scrapers, or custom content extractors.

#### Configuration

```bash
# Required: the endpoint URL. {url} is replaced with the encoded target URL.
export WEB_FETCH_API="https://my-scraper.example.com/fetch?url={url}"

# Optional: auth
export WEB_FETCH_API_KEY="my-secret-key"
export WEB_FETCH_API_AUTH_HEADER="Authorization"  # default
export WEB_FETCH_API_AUTH_SCHEME="Bearer"          # default

# Optional: extra headers (semicolon-separated)
export WEB_FETCH_API_HEADERS="X-Tenant: acme; Accept: text/markdown"

# Optional: timeout (default 30s)
export WEB_FETCH_CUSTOM_TIMEOUT_SEC=60
```

#### Response format

The endpoint should return the fetched content as plain text or markdown
in the response body. The raw text is used as-is (no parsing).

#### Security Guardrails

| Guardrail | Default | Override |
|-----------|---------|----------|
| HTTPS-only | ✅ | `WEB_FETCH_CUSTOM_ALLOW_HTTP=true` |
| Block private IPs / localhost | ✅ | `WEB_FETCH_CUSTOM_ALLOW_PRIVATE=true` |
| Request timeout | 30s | `WEB_FETCH_CUSTOM_TIMEOUT_SEC=<seconds>` |

## Comparison with WebSearch Providers

| Feature | WebSearch | WebFetch |
|---|---|---|
| Providers | 14 (custom, tavily, exa, you, jina, bing, mojeek, linkup, firecrawl, ddg + native) | 4 (default, jina, firecrawl, custom) |
| Auto fallback | ✅ | ✅ |
| Config var | `WEB_SEARCH_PROVIDER` | `WEB_FETCH_PROVIDER` |
| Retry | ✅ (1 retry, 500ms) | ✅ (1 retry, 500ms) |
| Default timeout | 15s (custom provider) | 60s (default), 30s (custom) |

## Adding a Provider

1. Create `providers/myprovider.ts`:

```typescript
import type { FetchProvider, FetchResult, RedirectInfo } from './types.js'

export const myProvider: FetchProvider = {
  name: 'myprovider',
  isConfigured() { return Boolean(process.env.MYPROVIDER_API_KEY) },
  async fetch(url: string, signal?: AbortSignal): Promise<FetchResult | RedirectInfo> {
    // ... call API, return FetchResult ...
    return {
      content: markdownContent,
      bytes: contentSize,
      code: 200,
      codeText: 'OK',
      contentType: 'text/markdown',
    }
  },
}
```

2. Register in `providers/index.ts` — add import and push to `ALL_PROVIDERS`.
