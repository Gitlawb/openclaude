# OpenClaude — Fix: 400 API Errors for Gemini, Mistral & OpenAI-Compatible Providers

## Overview

This PR resolves multiple **400 API errors** when using OpenClaude with Gemini, Mistral, and other non-OpenAI providers through the OpenAI-compatible shim layer.

Based on [PR #599](https://github.com/Gitlawb/openclaude/pull/599) from `Gitlawb/openclaude`.

---

## Bugs Fixed

### 1. `store: false` → 400 on Gemini & Mistral

**Error:** `Invalid JSON payload received. Unknown name "store": Cannot find field.`

The `store` parameter is OpenAI-only. Gemini and Mistral reject it with HTTP 400.

**Fix:** Added `providerSupportsStore()` — only includes `store: false` for providers that support it (OpenAI, Azure, Groq, DeepSeek). Omitted for Gemini and Mistral.

### 2. `thought_signature` missing → 400 on Gemini

**Error:** `Function call is missing a thought_signature in functionCall parts`

Two sub-issues:
- **2a.** The signature resolution chain in `convertMessages` only checked `tu.signature` and `thinkingBlock.signature`, but never read from `tu.extra_content.google.thought_signature` — which is exactly where Gemini stores it in previous responses.
- **2b.** The signature was only nested in `extra_content.google`, but Gemini's OpenAI-compatible endpoint also reads it as a top-level field on tool_calls to map to the native functionCall format.

**Fix:** Extended the resolution chain to also check `tu.extra_content.google.thought_signature`. Added `thought_signature` as a top-level field on tool_call objects for Gemini.

### 3. `extra_content` leaking to non-Gemini providers → 400 on Groq/DeepSeek/Ollama

When conversation history contains Gemini tool calls with `extra_content.google.thought_signature`, replaying those messages to a different provider (e.g. Groq) sends non-standard fields that strict providers reject.

**Fix:** Added `stripProviderSpecificFields()` — strips `extra_content` and `thought_signature` from tool_calls for non-Gemini providers.

### 4. GitHub Copilot fallback `max_output_tokens` always undefined

The GitHub Copilot `/responses` fallback path checked `body.max_tokens`, but the GitHub-specific handling above already moved the value and deleted `body.max_completion_tokens`. For non-GitHub providers using `max_completion_tokens`, the fallback always sent `max_output_tokens: undefined`.

**Fix:** Check `body.max_completion_tokens ?? body.max_tokens` to cover all cases.

### 5. `convertToolResultContent` produces `""` for null content

When a tool result has `null` content, `JSON.stringify(null ?? "")` evaluates to `JSON.stringify("")` → `""`. The model receives the literal string `""` instead of an empty string.

**Fix:** Handle `null`/`undefined` explicitly — return `''` directly.

---

## Changes

| File | Changes |
|------|---------|
| `src/services/api/openaiShim.ts` | +89 lines: provider detection, field stripping, signature resolution, null handling |
| `src/services/api/openaiShim.test.ts` | +314 lines: 6 new tests, 2 updated |

---

## Testing

```bash
bun test src/services/api/openaiShim.test.ts
```

**Result:** 45 pass, 0 fail, 97 expect() calls

All existing tests continue to pass. New tests cover:
- `store` omission for Gemini and Mistral
- `store` inclusion for standard OpenAI
- `thought_signature` as top-level field for Gemini
- `thought_signature` sentinel fallback
- `extra_content` stripping for non-Gemini providers
- Updated: Gemini `extra_content` preservation (now properly sets Gemini mode)

---

## Build

```bash
bun run build
```

**Result:** ✓ Built openclaude v0.1.8 → dist/cli.mjs

---

## Provider Compatibility Matrix

| Provider | `store` | `thought_signature` | `extra_content` stripping |
|----------|---------|--------------------|-----------------------|
| OpenAI | included | N/A | stripped |
| Azure | included | N/A | stripped |
| Gemini | omitted | top-level + nested | preserved |
| Mistral | omitted | N/A | stripped |
| Groq | included | N/A | stripped |
| DeepSeek | included | N/A | stripped |
| Ollama | included | N/A | stripped |

---

## Commits

| SHA | Description |
|-----|-------------|
| `feb5477` | fix: resolve 400 errors for Gemini, Mistral, and other OpenAI-compatible providers |
| `166c4be` | feat: enable thinking for Gemini (thinking=true) and reasoning_effort for OpenAI |
| `afe4005` | feat: runtime probe for thinking support per Gemini model |
| `ee59ec7` | feat: probe thinking support for ALL providers, not just Gemini |

---

## How to Test

```bash
# Clone and checkout
git clone https://github.com/FluxLuFFy/openclaude.git
cd openclaude
git checkout pr-599-readme

# Run the shim tests
bun test src/services/api/openaiShim.test.ts

# Run full test suite
bun test

# Build
bun run build
```

---

## Notes

- This PR adds documentation and test references for the fixes from Gitlawb/openclaude#599.
- The actual code changes are in the source PR; this branch contains the README for tracking and review purposes.
- Two additional commits (`afe4005`, `ee59ec7`) related to thinking probe support were reverted separately.
