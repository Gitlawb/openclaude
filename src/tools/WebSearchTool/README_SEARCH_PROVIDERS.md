# Web Search Tool — New Providers & Custom API Support

## What Changed

Added support for **custom search API backends** in `WebSearchTool.ts`, allowing OpenClaude to use any HTTP-based search provider (not just DuckDuckGo, Firecrawl, or Anthropic's native web search).

### New Provider: Custom Search API

A new search path runs **before all existing providers** when configured. It connects to an arbitrary HTTP endpoint and parses a standardized JSON response format.

**Priority order (highest → lowest):**
1. **Custom API** (`WEB_SEARCH_API`) — new
2. **Firecrawl** (`FIRECRAWL_API_KEY`)
3. **DuckDuckGo** (default fallback for non-Claude models)
4. **Codex Responses** (OpenAI backend)
5. **Native Anthropic** (firstParty / vertex / foundry)

---

## How to Use

### Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `WEB_SEARCH_API` | ✅ (for custom API) | — | Base URL of your custom search endpoint |
| `WEB_KEY` | ❌ | — | API key passed as `key` query parameter |
| `WEB_PARMS` | ❌ | `q` | Query parameter name (e.g., `q`, `query`, `search`) |

### Example Configuration

```bash
# Using SearXNG
export WEB_SEARCH_API="https://search.example.com/search"
export WEB_PARMS="q"

# Using Google Custom Search
export WEB_SEARCH_API="https://www.googleapis.com/customsearch/v1"
export WEB_KEY="YOUR_API_KEY"
export WEB_PARMS="q"
```

### Expected API Response Format

Your custom search API should return JSON in this format:

```json
{
  "date": "2025-01-01",
  "query": "search terms",
  "results": {
    "engine_name": [
      {
        "title": "Result Title",
        "url": "https://example.com/page",
        "source": "example.com",
        "description": "A short snippet of the result."
      }
    ]
  }
}
```

- `results` is a map of engine name → array of hits
- Each hit must have at least `title` and `url`
- `description` is optional but recommended (shown as snippets)
- `source` is optional metadata

### Request Format

The tool sends a `GET` request:

```
GET {WEB_SEARCH_API}?key={WEB_KEY}&{WEB_PARMS}={query}
Content-Type: application/json
```

---

## Features

- **Domain filtering** — `allowed_domains` and `blocked_domains` work identically to the DuckDuckGo/Firecrawl paths
- **Snippet display** — descriptions are formatted as bold title + description, same style as other providers
- **Graceful fallback** — if the custom API fails, it falls through to the next available provider
- **Priority override** — custom API takes precedence over all other search backends when configured

## Existing Providers (unchanged)

| Provider | Env Var | Notes |
|---|---|---|
| DuckDuckGo | *(default)* | Free, no API key needed, rate-limited |
| Firecrawl | `FIRECRAWL_API_KEY` | Premium, reliable |
| Native Anthropic | *(firstParty/vertex)* | Requires Anthropic API, US only |
| Codex/OpenAI | `OPENAI_BASE_URL` + `CODEX_API_KEY` | OpenAI responses backend |
