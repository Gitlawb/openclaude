# Concentrate Setup

OpenClaude connects to [Concentrate AI](https://concentrate.ai) through its OpenAI-compatible endpoint at `https://api.concentrate.ai/v1`.

## Overview

Concentrate AI is an aggregating gateway that exposes 150+ chat models behind a single OpenAI-compatible API. OpenClaude ships a first-class `Concentrate` provider preset: it uses `CONCENTRATE_API_KEY`, falls back to `OPENAI_API_KEY`, and auto-discovers the chat model catalog from the public `/v1/models` endpoint. It defaults to `deepseek-v4-flash-0731`.

## Prerequisites

- A Concentrate AI account and API key from <https://concentrate.ai>.
- Concentrate API keys start with `sk-cn`.

## Interactive setup (`/provider`)

1. Start OpenClaude and run `/provider`.
2. Choose **Concentrate**.
3. Paste your `CONCENTRATE_API_KEY` (or `OPENAI_API_KEY` if you want to reuse a generic OpenAI-compatible key).
4. The base URL (`https://api.concentrate.ai/v1`) and default model (`deepseek-v4-flash-0731`) are filled in automatically.
5. Switch models any time with `/model`; the picker lists chat-capable models discovered from the Concentrate catalog.

## Environment variables

Set the key directly and use the generic OpenAI-compatible route:

```bash
export CLAUDE_CODE_USE_OPENAI=1
export CONCENTRATE_API_KEY="sk-cn-your-key-here"
export CONCENTRATE_BASE_URL="https://api.concentrate.ai/v1"  # optional
export CONCENTRATE_MODEL="deepseek-v4-flash-0731"            # optional
```

`OPENAI_API_KEY` also works as a fallback credential for the route.

## Verify

- `/status` shows **Concentrate** as the active provider with the `https://api.concentrate.ai/v1` base URL.
- `/model` lists chat-capable models discovered from the Concentrate catalog.
- Send any prompt to confirm responses come back from the selected model.

## Notes

- Model discovery uses the public, unauthenticated `GET /v1/models` endpoint. Non-chat models (embeddings, audio, redaction, moderation, etc.) are filtered out automatically.
- Every model keeps its native Concentrate model ID (`deepseek-v4-flash-0731`, `claude-sonnet-5`, `gpt-4o`, etc.) so switching with `/model` works exactly as on the Concentrate dashboard.
- Usage (`/usage`) reporting is not supported for this provider yet.
