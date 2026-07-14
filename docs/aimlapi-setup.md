# AI/ML API Setup

OpenClaude connects to [AI/ML API](https://aimlapi.com) through its OpenAI-compatible endpoint at `https://api.aimlapi.com/v1`.

## Overview

AI/ML API is an aggregating gateway that exposes many chat models behind a single OpenAI-compatible API. OpenClaude ships a first-class `AI/ML API` provider preset: it stores credentials under `AIMLAPI_API_KEY`, sends the OpenClaude attribution headers, and discovers chat-capable models from the public `/models` catalog. It defaults to `gpt-4o`.

## Prerequisites

None. You don't need to visit <https://aimlapi.com> first — the guided top-up flow below can create an AI/ML API account and issue a key for you. If you already have a key from the dashboard, you can paste it directly instead.

## Option 1 — Interactive (`/provider`)

1. Start OpenClaude and run `/provider`.
2. Choose **AI/ML API**, then confirm the default model (Step 1 of 2).
3. Step 2 of 2 — choose how to get an API key:
   - **Top up and get API key** — enter your AI/ML API email and password (an account is created automatically if you don't have one yet), pick a top-up amount ($20–$10,000) and payment method (card or crypto), complete payment in the browser, and OpenClaude saves the issued key for you.
   - **Enter existing API key** — paste a key you already have from the AI/ML API dashboard.

Either way, the base URL (`https://api.aimlapi.com/v1`) and default model (`gpt-4o`) are filled in automatically.

Switch models any time with `/model` — only chat-capable models from the AI/ML API catalog are listed.

## Option 2 — CLI (`openclaude aimlapi topup`)

Run the same guided top-up flow non-interactively:

```bash
openclaude aimlapi topup --email you@example.com --amount 25 --method card
```

- Credentials: pass `--email` (or set `AIMLAPI_EMAIL`) and set `AIMLAPI_PASSWORD`; if either is missing you're prompted interactively (password entry is hidden).
- `--amount`: top-up amount in USD (min 20, max 10000; defaults to 25).
- `--method`: `card` (Stripe, default) or `crypto` (NOWPayments).
- `--model`: default model id written into the provider profile (defaults to `gpt-4o`).
- `--no-open`: print the payment URL instead of auto-opening a browser.

The issued key is written into OpenClaude's provider profile automatically once payment clears.

## Option 3 — Environment variables

Setting `AIMLAPI_API_KEY` alone is enough; OpenClaude auto-detects the AI/ML API route:

```bash
export AIMLAPI_API_KEY="your-aimlapi-key"
```

To configure the OpenAI-compatible route explicitly:

```bash
export CLAUDE_CODE_USE_OPENAI=1
export AIMLAPI_API_KEY="your-aimlapi-key"
export OPENAI_BASE_URL="https://api.aimlapi.com/v1"
export OPENAI_MODEL="gpt-4o"
```

`OPENAI_API_KEY` also works as a fallback credential for the route.

## Verify

- `/status` shows **AI/ML API** as the active provider with the `https://api.aimlapi.com/v1` base URL.
- `/model` lists chat-capable models discovered from the catalog.
- Send any prompt to confirm responses come back from the selected model.

## Notes

- Model discovery uses the public, unauthenticated `GET /models` endpoint and surfaces only chat-completions models; image, audio, embeddings, and other modalities are intentionally not routed through the coding workflow.
- Requests carry `X-AIMLAPI-Integration-*` attribution headers (owner/repo/version) plus the `HTTP-Referer: OpenClaude` and `X-Title: OpenClaude` headers that AI/ML API uses to attribute integration traffic.
- Usage (`/usage`) reporting is not supported for this provider.
