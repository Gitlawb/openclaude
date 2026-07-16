# AI/ML API Setup

OpenClaude connects to [AI/ML API](https://aimlapi.com) through its OpenAI-compatible endpoint at `https://api.aimlapi.com/v1`.

## Overview

AI/ML API is an aggregating gateway that exposes many chat models behind a single OpenAI-compatible API. OpenClaude ships a first-class `AI/ML API` provider preset: it uses `AIMLAPI_API_KEY`, sends the OpenClaude attribution headers, and discovers chat-capable models from the public `/models` catalog. It defaults to `anthropic/claude-sonnet-5`.

## Prerequisites

None. You do not need to visit <https://aimlapi.com> first - the guided top-up flow can create an account and issue a key. If you already have a dashboard key or set `AIMLAPI_API_KEY`, OpenClaude can use that credential instead.

## Option 1 - Interactive (`/provider`)

1. Start OpenClaude and run `/provider`.
2. Choose **AI/ML API**.
3. If AI/ML API is already configured, choose one of:
   - **Use existing configuration** - validate the saved key or `AIMLAPI_API_KEY`, check its balance, optionally top up a low balance, then choose a model.
   - **Configure again** - enter the normal new-user or existing-key flow.
4. Otherwise choose how to get an API key:
   - **I am a new user** - enter your email. OpenClaude creates a passwordless account, lets you pick a top-up amount and automatic top-up preference, opens card checkout, then saves the issued key.
   - **I already have an AI/ML API key** - paste a key from the dashboard. OpenClaude validates it, checks its balance, and offers an optional API-key top-up when the balance is low.

For an email that already has an account, AI/ML API sends a 6-digit sign-in code. OpenClaude creates a new API key for that account, checks its balance, and only offers checkout when the balance is low. You can top up or save the key and skip funding for now.

When `AIMLAPI_API_KEY` supplies the credential, OpenClaude uses its runtime value for validation and balance checks but saves an empty credential in the provider profile. The literal environment value is not copied into configuration.

Checkout progress is retained while the provider flow remains open. Retrying an ambiguous payment or exchange failure resumes the original partner session instead of creating a second checkout.

The base URL (`https://api.aimlapi.com/v1`) and default model (`anthropic/claude-sonnet-5`) are filled in automatically. Switch models any time with `/model`; only chat-capable models from the AI/ML API catalog are listed.

## Option 2 - CLI (`openclaude aimlapi topup`)

Run the guided account top-up flow from the CLI:

```bash
openclaude aimlapi topup --email you@example.com --amount 25
```

- Pass `--email` (or set `AIMLAPI_EMAIL`). Existing accounts also need the emailed `--code` (or `AIMLAPI_CODE`); interactive terminals prompt for missing values.
- `--amount`: top-up amount in USD (min 20, max 10000; defaults to 25).
- Checkout always uses card payment; there is no separate payment-method step.
- `--auto-top-up`: enroll the account in automatic top-up at checkout.
- `--model`: default model id written into the provider profile (defaults to `anthropic/claude-sonnet-5`).
- `--no-open`: print the payment URL instead of auto-opening a browser.

The issued key is written into OpenClaude's provider profile automatically once payment clears.

## Option 3 - Environment variables

Setting `AIMLAPI_API_KEY` alone is enough; OpenClaude auto-detects the AI/ML API route:

```bash
export AIMLAPI_API_KEY="your-aimlapi-key"
```

To configure the OpenAI-compatible route explicitly:

```bash
export CLAUDE_CODE_USE_OPENAI=1
export AIMLAPI_API_KEY="your-aimlapi-key"
export OPENAI_BASE_URL="https://api.aimlapi.com/v1"
export OPENAI_MODEL="anthropic/claude-sonnet-5"
```

`OPENAI_API_KEY` also works as a fallback credential for the route.

## Verify

- `/status` shows **AI/ML API** as the active provider with the `https://api.aimlapi.com/v1` base URL.
- `/model` lists chat-capable models discovered from the catalog.
- Send any prompt to confirm responses come back from the selected model.

## Notes

- Model discovery uses the public, unauthenticated `GET /models` endpoint and surfaces only chat-completions models; image, audio, embeddings, and other modalities are intentionally not routed through the coding workflow.
- Requests carry `X-AIMLAPI-Integration-*` attribution headers (owner/repo/version) plus the `HTTP-Referer: OpenClaude` and `X-Title: OpenClaude` headers that AI/ML API uses to attribute integration traffic.
- `AIMLAPI_AUTH_URL`, `AIMLAPI_APP_URL`, `AIMLAPI_PAY_URL`, `AIMLAPI_INFERENCE_URL`, and `AIMLAPI_VERIFICATION_BASE_URL` can point the complete flow at another environment. `AIMLAPI_RETURN_URL` overrides only the browser landing page.
- Checkout success is detected by polling. The browser return target is an HTTPS page; OpenClaude does not install a custom URL-scheme handler.
- Usage (`/usage`) reporting is not supported for this provider.
