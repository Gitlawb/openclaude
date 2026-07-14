# OpenClaude Advanced Setup

This guide is for users who want source builds, Bun workflows, provider profiles, diagnostics, or more control over runtime behavior.

## Install Options

OpenClaude requires Node.js `>=22.0.0` for npm installs and runtime. Bun is
only required when building or running from source.

### Option A: npm

```bash
npm install -g @gitlawb/openclaude@latest
```

### Option B: From source with Bun

Use Bun `1.3.13` or newer for source builds. Older Bun versions can fail during `bun run build`.

```bash
git clone https://github.com/Gitlawb/openclaude.git
cd openclaude

bun install
bun run build
npm link
```

### Option C: Run directly with Bun

```bash
git clone https://github.com/Gitlawb/openclaude.git
cd openclaude

bun install
bun run dev
```

## Provider Examples

### OpenAI

```bash
export CLAUDE_CODE_USE_OPENAI=1
export OPENAI_API_KEY=sk-...
export OPENAI_MODEL=gpt-4o
```

### Codex via ChatGPT auth

`codexplan` maps to GPT-5.5 on the Codex backend with high reasoning.
`codexspark` maps to GPT-5.3 Codex Spark for faster loops.

If you use the in-app provider wizard, choose `Codex OAuth` to open ChatGPT sign-in in your browser and let OpenClaude store Codex credentials securely.

If you already use the Codex CLI, OpenClaude reads `~/.codex/auth.json` automatically. You can also point it elsewhere with `CODEX_AUTH_JSON_PATH` or override the token directly with `CODEX_API_KEY`.

If you set `CODEX_API_KEY` manually and are not relying on `auth.json` or stored
Codex OAuth credentials, also set `CHATGPT_ACCOUNT_ID` (or
`CODEX_ACCOUNT_ID`).

```bash
export CLAUDE_CODE_USE_OPENAI=1
export OPENAI_MODEL=codexplan

# optional if you do not already have ~/.codex/auth.json
export CODEX_API_KEY=...
export CHATGPT_ACCOUNT_ID=...

openclaude
```

### DeepSeek

```bash
export CLAUDE_CODE_USE_OPENAI=1
export OPENAI_API_KEY=sk-...
export OPENAI_BASE_URL=https://api.deepseek.com/v1
export OPENAI_MODEL=deepseek-v4-flash
```

Use `deepseek-v4-pro` when you want the stronger model. `deepseek-chat` and `deepseek-reasoner` remain available as DeepSeek's legacy API aliases.

### Google Gemini

```bash
export CLAUDE_CODE_USE_GEMINI=1
export GEMINI_API_KEY=...
export GEMINI_MODEL=gemini-3-flash-preview
```

### Claude on Vertex AI

The Vertex route uses Anthropic's Claude-on-Vertex API. It is not a general
Vertex AI Model Garden adapter for Gemini or arbitrary partner models; use the
Gemini provider for Gemini models and OpenAI-compatible routes for compatible
third-party gateways.

Authentication uses Google Application Default Credentials through
`google-auth-library`. There is no `OPENAI_API_KEY`-style API key for this
route. **For global npm installs, install the auth package on demand** (it is
not bundled by default — see [Optional provider packages](#optional-provider-packages)):

```bash
npm i -g google-auth-library
```

Authenticate with either local Application Default Credentials (ADC) or a
service-account key file:

```bash
# Option 1 — local ADC (interactive, uses your own Google account):
gcloud auth application-default login

# Option 2 — service-account key file (headless / CI):
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
```

Minimal setup:

```bash
export CLAUDE_CODE_USE_VERTEX=1
export ANTHROPIC_VERTEX_PROJECT_ID=my-gcp-project
export GOOGLE_CLOUD_PROJECT=my-gcp-project
export CLOUD_ML_REGION=us-east5

openclaude --model claude-sonnet-4-6
```

`CLOUD_ML_REGION` is optional and defaults to `us-east5`. Model-specific
Vertex region override variables are also supported for Claude models; see
`src/utils/envUtils.ts` for the current override names.

### Gemini via OpenRouter

```bash
export CLAUDE_CODE_USE_OPENAI=1
export OPENAI_API_KEY=sk-or-...
export OPENAI_BASE_URL=https://openrouter.ai/api/v1
export OPENAI_MODEL=google/gemini-2.5-pro
```

OpenRouter model availability changes over time. If a model stops working, try another current OpenRouter model before assuming the integration is broken.

### Ollama

```bash
ollama pull llama3.3:70b

export CLAUDE_CODE_USE_OPENAI=1
export OPENAI_BASE_URL=http://localhost:11434/v1
export OPENAI_MODEL=llama3.3:70b
```

#### Ollama Context Length

OpenClaude sends the current conversation history to Ollama on each turn and
uses Ollama's native chat API for Ollama endpoints. Native chat lets OpenClaude
send `options.num_ctx` with each request, so Ollama receives a 32768-token
context window by default instead of falling back to the smaller context often
used by Ollama's OpenAI-compatible `/v1/chat/completions` shim.

To choose a different request-level context size, set
`OPENCLAUDE_OLLAMA_NUM_CTX` before launching OpenClaude:

```bash
export OPENCLAUDE_OLLAMA_NUM_CTX=65536
```

You can also start Ollama with a global context length:

macOS / Linux:

```bash
# Stop any existing Ollama app/server first, then run:
OLLAMA_CONTEXT_LENGTH=32768 ollama serve
```

Windows PowerShell:

```powershell
# Quit any existing Ollama app/server first, then run:
$env:OLLAMA_CONTEXT_LENGTH="32768"
ollama serve
```

After a chat request, verify the loaded model is using the requested context:

```bash
ollama ps
```

Check the `CONTEXT` column. If it still shows a small value such as `4K` after a
new OpenClaude request, stop the existing Ollama app/server, start it again, and
retry the request.

Use a concrete recall test after changing the setting, such as asking the model
to repeat the first topic from the current chat. Questions like "do you remember our
conversation?" can trigger generic local-model disclaimers even when history is
present.

### Atomic Chat (local, Apple Silicon)

```bash
export CLAUDE_CODE_USE_OPENAI=1
export OPENAI_BASE_URL=http://127.0.0.1:1337/v1
export OPENAI_MODEL=your-model-name
```

No API key is needed for Atomic Chat local models.

Or use the profile launcher:

```bash
bun run dev:atomic-chat
```

Download Atomic Chat from [atomic.chat](https://atomic.chat/). The app must be running with a model loaded before launching.

### LM Studio

```bash
export CLAUDE_CODE_USE_OPENAI=1
export OPENAI_BASE_URL=http://localhost:1234/v1
export OPENAI_MODEL=your-model-name
```

### Together AI

```bash
export CLAUDE_CODE_USE_OPENAI=1
export OPENAI_API_KEY=...
export OPENAI_BASE_URL=https://api.together.xyz/v1
export OPENAI_MODEL=meta-llama/Llama-3.3-70B-Instruct-Turbo
```

### Groq

```bash
export CLAUDE_CODE_USE_OPENAI=1
export GROQ_API_KEY=gsk_...
export OPENAI_BASE_URL=https://api.groq.com/openai/v1
export OPENAI_MODEL=llama-3.3-70b-versatile
```

`GROQ_API_KEY` matches the built-in Groq gateway preset. `OPENAI_API_KEY` also works as a fallback on the generic OpenAI-compatible path, but `GROQ_API_KEY` is the preferred variable for Groq-specific setup.

### OpenCode Zen (pay-as-you-go)

```bash
export CLAUDE_CODE_USE_OPENAI=1
export OPENCODE_API_KEY=...
export OPENAI_BASE_URL=https://opencode.ai/zen/v1
export OPENAI_MODEL=gpt-5.4

openclaude
```

OpenCode Zen is a pay-as-you-go AI gateway with 48 models (GPT, Claude, Gemini,
Qwen, MiniMax, GLM, Kimi, Grok, Big Pickle, DeepSeek, Nemotron). Uses the same
`OPENCODE_API_KEY` as OpenCode Go. Get your key from https://opencode.ai.

### OpenCode Go (subscription)

```bash
export CLAUDE_CODE_USE_OPENAI=1
export OPENCODE_API_KEY=...
export OPENAI_BASE_URL=https://opencode.ai/zen/go/v1
export OPENAI_MODEL=glm-5.1

openclaude
```

OpenCode Go is a $10/mo subscription for 13 open models (GLM, Kimi, DeepSeek,
MiMo, MiniMax, Qwen). Uses the same `OPENCODE_API_KEY` as OpenCode Zen.

### Gitlawb Opengateway

```bash
export CLAUDE_CODE_USE_OPENAI=1
export OPENAI_BASE_URL=https://opengateway.gitlawb.com/v1
export OPENGATEWAY_API_KEY=ogw_live_...
export OPENAI_MODEL=mimo-v2.5-pro
```

The Opengateway route is the fresh-install startup default and requires an API
key from https://gitlawb.com/opengateway/keys. Keep the base URL at `/v1` and
switch models with `/model` or `OPENAI_MODEL`. Current partner models include:

- `mimo-v2.5-pro`
- `google/gemini-3.1-flash-lite-preview`

### Xiaomi MiMo

```bash
export CLAUDE_CODE_USE_OPENAI=1
export MIMO_API_KEY=...
export OPENAI_BASE_URL=https://api.xiaomimimo.com/v1
export OPENAI_MODEL=mimo-v2.5-pro
```

The `/provider` Xiaomi MiMo preset uses the same endpoint and stores the key as `MIMO_API_KEY`. `OPENAI_API_KEY` also works as a compatibility fallback, but `MIMO_API_KEY` keeps the profile tied to the MiMo route.

### NEAR AI

```bash
export CLAUDE_CODE_USE_OPENAI=1
export NEARAI_API_KEY=...
export OPENAI_BASE_URL=https://cloud-api.near.ai/v1
export OPENAI_MODEL=anthropic/claude-sonnet-4-6

openclaude
```

NEAR AI is a unified OpenAI-compatible gateway that proxies Anthropic, OpenAI,
and Google models alongside TEE-hosted open models (GLM 5.1, Qwen3.5, Kimi K2.6).
All models are accessible from a single endpoint with one API key.
Get your key from https://cloud.near.ai/dashboard/organizations.

Model IDs use `provider/model-name` format (e.g. `anthropic/claude-opus-4-7`,
`openai/gpt-5.5`, `google/gemini-3.5-flash`, `zai-org/GLM-5.1-FP8`).

For direct TEE completions (lower latency, verifiable privacy):

```bash
export OPENAI_BASE_URL=https://qwen35-122b.completions.near.ai/v1
```

### Cloudflare Workers AI

```bash
export CLAUDE_CODE_USE_OPENAI=1
export CLOUDFLARE_API_TOKEN=...
export OPENAI_BASE_URL=https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/v1
export OPENAI_MODEL=@cf/meta/llama-3.3-70b-instruct-fp8-fast
```

Replace `<ACCOUNT_ID>` with your Cloudflare account id (visible in the Cloudflare dashboard URL). `OPENAI_API_KEY` also works as a compatibility fallback, but `CLOUDFLARE_API_TOKEN` keeps the profile tied to the Cloudflare preset. The `/provider` Cloudflare Workers AI preset stores the token under `CLOUDFLARE_API_TOKEN`.

### Mistral

```bash
export CLAUDE_CODE_USE_MISTRAL=1
export MISTRAL_API_KEY=...
export MISTRAL_MODEL=devstral-latest
```

### Azure OpenAI

```bash
export CLAUDE_CODE_USE_OPENAI=1
export OPENAI_API_KEY=your-azure-key
export OPENAI_BASE_URL=https://your-resource.openai.azure.com/openai/deployments/your-deployment/v1
export OPENAI_MODEL=gpt-4o
```

### Microsoft Foundry / Azure OpenAI (resource URL + deployment)

When your endpoint is the **resource base URL** (not the full `.../deployments/.../v1` path), set `OPENAI_MODEL` to the **deployment name** and `AZURE_OPENAI_API_VERSION` to your API version. The OpenAI shim builds:

`{base}/openai/deployments/{OPENAI_MODEL}/chat/completions?api-version={AZURE_OPENAI_API_VERSION}`

and sends the key in the `api-key` header for Azure hosts.

```bash
export CLAUDE_CODE_USE_OPENAI=1
export OPENAI_API_KEY=your-azure-key
export OPENAI_BASE_URL=https://your-resource.openai.azure.com
export OPENAI_MODEL=your-deployment-name
export AZURE_OPENAI_API_VERSION=2024-12-01-preview
```

If your hostname is not detected as Azure (for example some inference endpoints), force Azure URL and header behavior:

```bash
export OPENAI_AZURE_STYLE=1
```

### Fireworks AI

Fireworks AI provides a fully OpenAI-compatible endpoint. Model IDs use the full path format `accounts/fireworks/models/<model-name>`.

```bash
export CLAUDE_CODE_USE_OPENAI=1
export FIREWORKS_API_KEY=fw_your_key_here
export OPENAI_BASE_URL=https://api.fireworks.ai/inference/v1
export OPENAI_MODEL=accounts/fireworks/models/llama-v3p1-70b-instruct
```

The **OpenClaude VS Code extension** can store the key in Secret Storage and set these variables for you when you launch from the Control Center. See `vscode-extension/openclaude-vscode/README.md`.

## Optional provider packages

To keep the default `npm i -g @gitlawb/openclaude` install small and
warning-free, a few provider SDKs and the native image library are **not
bundled**. They are loaded on demand, and the CLI prints an `npm install <pkg>`
hint (add `-g` for the global CLI) if you enable a feature whose package is
missing. Install only what you need:

| Feature | Trigger | Install |
| --- | --- | --- |
| AWS Bedrock | `CLAUDE_CODE_USE_BEDROCK=1` | `npm i -g @anthropic-ai/bedrock-sdk`. Profile-based auth (`~/.aws/credentials`) additionally needs `@aws-sdk/credential-providers` and `@aws-sdk/client-sts`; model listing needs `@aws-sdk/client-bedrock`. Proxy and skip-auth setups may also need `@aws-sdk/credential-provider-node`, `@smithy/node-http-handler`, or `@smithy/core`. The CLI prints the exact missing package if you hit one. |
| Azure Foundry | `CLAUDE_CODE_USE_FOUNDRY=1` | `npm i -g @anthropic-ai/foundry-sdk @azure/identity` |
| Claude on Vertex AI / Gemini ADC | `CLAUDE_CODE_USE_VERTEX=1` / Gemini ADC auth | `npm i -g google-auth-library` |
| Reading/processing images | reading an image file | `npm i -g sharp` |

When installing OpenClaude from source (`bun install`), all of these are
already present as dev dependencies, so source/dev builds need no extra steps.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CLAUDE_CODE_USE_OPENAI` | OpenAI-compatible only | Set to `1` to enable the OpenAI-compatible provider path |
| `OPENAI_API_KEYS` | One of `OPENAI_API_KEYS` or `OPENAI_API_KEY` for non-local OpenAI-compatible cloud routes* | Comma-separated OpenAI-compatible API key pool. Takes precedence over `OPENAI_API_KEY` and rotates to the next key on auth, quota, or rate-limit failures (`*` not needed for local models like Ollama, LM Studio, Atomic Chat, or other local OpenAI-compatible proxies). |
| `OPENAI_API_KEY` | Required only when `OPENAI_API_KEYS` is unset or empty for non-local OpenAI-compatible cloud routes* | Your API key (`*` not needed for local models like Ollama, LM Studio, Atomic Chat, or other local OpenAI-compatible proxies). A comma-separated list also enables key rotation. |
| `OPENAI_MODEL` | OpenAI-compatible only | Model name such as `gpt-4o`, `deepseek-v4-flash`, or `llama3.3:70b` |
| `OPENAI_BASE_URL` | No | API endpoint, defaulting to `https://api.openai.com/v1` |
| `OPENAI_API_BASE` | No | Compatibility alias for `OPENAI_BASE_URL` |
| `OPENCLAUDE_OLLAMA_NUM_CTX` | Ollama only | Request-level Ollama context window. Defaults to `32768`; set a larger value for longer same-session history if your model and hardware can handle it. |
| `CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS` | No | JSON map of OpenAI-compatible model names to context windows, such as `{"custom-model":1000000}`. Use this when a custom provider does not expose context metadata from `/v1/models`. |
| `CLAUDE_CODE_OPENAI_MAX_OUTPUT_TOKENS` | No | JSON map of OpenAI-compatible model names to max output tokens, such as `{"custom-model":32768}`. Use this when a custom provider does not expose output-limit metadata from `/v1/models`. |
| `OPENCODE_API_KEY` | OpenCode Zen / Go | Shared API key for OpenCode Zen (pay-as-you-go) and OpenCode Go (subscription); get yours from https://opencode.ai |
| `MIMO_API_KEY` | Xiaomi MiMo route | Xiaomi MiMo API key for `https://api.xiaomimimo.com/v1`; mirrored into the OpenAI-compatible auth env when the MiMo route is active |
| `CLAUDE_CODE_USE_GEMINI` | Gemini only | Set to `1` to enable the direct Gemini provider path |
| `GEMINI_API_KEY` / `GOOGLE_API_KEY` | Gemini API-key auth | Gemini API key for direct Gemini setup |
| `GEMINI_MODEL` | Gemini only | Model name such as `gemini-3-flash-preview` or `gemini-2.5-pro` |
| `GEMINI_BASE_URL` | No | Override the Gemini base URL |
| `CLAUDE_CODE_USE_MISTRAL` | Mistral only | Set to `1` to enable the dedicated Mistral provider path |
| `MISTRAL_API_KEY` | Mistral only | Mistral API key |
| `MISTRAL_MODEL` | Mistral only | Model name such as `devstral-latest` |
| `MISTRAL_BASE_URL` | No | Override the Mistral base URL |
| `CODEX_API_KEY` | Codex only | Codex or ChatGPT access token override |
| `CHATGPT_ACCOUNT_ID` / `CODEX_ACCOUNT_ID` | Codex only | Required for manual Codex env setup when the account id is not coming from `auth.json` or stored OAuth credentials |
| `CODEX_AUTH_JSON_PATH` | Codex only | Path to a Codex CLI `auth.json` file |
| `CODEX_HOME` | Codex only | Alternative Codex home directory |
| `OPENCLAUDE_MAX_RETRIES` | No | Maximum retry attempts for retryable API failures, capped at 100 (default: 10). Set to `0` to disable retries after the initial request. If unset, deprecated `CLAUDE_CODE_MAX_RETRIES` is still honored for compatibility. |
| `OPENCLAUDE_RETRY_DELAY_MS` | No | Base retry delay in milliseconds for APIs that do not send `Retry-After`; exponential backoff starts from this value, capped at 60000 (default: 500) |
| `OPENCLAUDE_QUERY_HARD_MAX_MS` | No | Foreground query hard maximum in milliseconds. Defaults to 1800000 (30 minutes). Use a larger positive integer for long autonomous sessions; invalid, zero, negative, fractional, or timer-overflow values are ignored with a warning. |
| `OPENCLAUDE_DISABLE_CO_AUTHORED_BY` | No | Suppress the default `Co-Authored-By` trailer in generated git commits |
| `OPENCLAUDE_LOG_TOKEN_USAGE` | No | When truthy (e.g. `verbose`), emits one JSON line on stderr per API request with input/output/cache tokens and the resolved provider. **User-facing debug output** — complements the REPL display controlled by `/config showCacheStats`. Distinct from `CLAUDE_CODE_ENABLE_TOKEN_USAGE_ATTACHMENT`, which is **model-facing** (injects context usage info into the prompt itself). Both can run together. |

Model env vars are provider-scoped: first-party Anthropic sessions read
`ANTHROPIC_MODEL`, OpenAI-compatible sessions read `OPENAI_MODEL`, Gemini reads
`GEMINI_MODEL`, and Mistral reads `MISTRAL_MODEL`. For manual Bedrock, Vertex,
or Foundry launches, select the model with `--model`.

### Per-model limit overrides (`settings.json`)

When a custom OpenAI-compatible provider does not expose context metadata from
`/v1/models`, you can pin a model's context window and max output tokens. In
addition to the `CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS` /
`CLAUDE_CODE_OPENAI_MAX_OUTPUT_TOKENS` env vars above, you can set a
`modelLimits` map in your `settings.json` (the same file `/config` writes, e.g.
`~/.openclaude/settings.json`):

```json
{
  "modelLimits": {
    "my-custom-deployment": { "contextWindow": 262144, "maxOutputTokens": 32768 },
    "api.private-llm.test:my-custom-deployment": { "contextWindow": 1000000 }
  }
}
```

- **Key matching** — keys match the model api-name exactly, or by prefix (e.g.
  `my-custom` matches `my-custom-deployment-v2`). An **exact** key always wins
  over a **prefix** key. A host-qualified key (`<host>:<model>`) only wins over a
  bare key **within the same match kind** — a host-qualified exact key beats a
  bare exact key, and a host-qualified prefix beats a bare prefix, but a bare
  exact key still beats a host-qualified prefix. So to give the same model
  different limits per endpoint, use host-qualified **exact** keys for each
  endpoint. `<host>` is the `OPENAI_BASE_URL` host **including the port when the
  URL has one** (`new URL(baseUrl).host`): for `http://localhost:4000/v1` the
  key is `localhost:4000:my-model`, not `localhost:my-model`. Either field may be
  omitted to override only one limit.
- **Precedence** — from highest to lowest: an **exact** env-var override → the
  built-in catalog value → the discovery-cache value → a **prefix** env-var
  override → `modelLimits` → the descriptor default. (The built-in catalog is
  checked before the discovery cache.) So env-var overrides always win over
  `modelLimits`, and `modelLimits` mainly fills in models that have no built-in
  metadata (a known catalog model keeps its catalog limit unless you set an
  *exact* env override for it).

## Safety strictness

OpenClaude runs several "safety" checks: a model-level refusal directive, bash
command-injection validation, and sensitive-file / auto-edit guards. These are
conservative by design, but a few of them can surface as refusals or approval
prompts for entirely benign, routine coding tasks (e.g. editing `.gitmodules`,
running a build script that contains `$(date)`, or writing a CTF port scanner).
See [issue #1616](https://github.com/Gitlawb/openclaude/issues/1616).

Set `OPENCLAUDE_SAFETY_LEVEL` to dial strictness without changing behavior for
everyone:

| Value | Behavior |
|-------|----------|
| `strict` | Current/default-equivalent non-permissive behavior. |
| `balanced` | Default. Same behavior as `strict`. |
| `permissive` | Opt-in mode for users who prefer fewer false-positive stops. It bypasses the legacy bash command-injection validation path entirely, keeps ordinary interpreter allow-rules (`Bash(python:*)`, `Bash(npm run:*)`, …) when entering auto mode, and skips prompts for routine edits to filenames on the broad sensitive-file list. Dangerous directory, Windows-path, symlink-resolved path, and UNC guards remain active. The model-level prompt is not weakened by this flag. |

```bash
export OPENCLAUDE_SAFETY_LEVEL=permissive   # relax benign-task false positives
```

## Runtime Hardening

Use these commands to validate your setup and catch mistakes early:

```bash
# quick startup sanity check
bun run smoke

# validate provider env + reachability
bun run doctor:runtime

# print machine-readable runtime diagnostics
bun run doctor:runtime:json

# persist a diagnostics report to reports/doctor-runtime.json
bun run doctor:report

# print a redacted public issue report
openclaude doctor report --markdown

# write a redacted JSON issue report for attachment
openclaude doctor report --json --out openclaude-report.json

# write a deterministic task report from a session transcript
openclaude report --json --transcript ~/.openclaude/projects/-path-to-project/session-id.jsonl --out task-report.json

# print a human-readable task report from the latest session in the current project
openclaude report --markdown

# full local hardening check (smoke + runtime doctor)
bun run hardening:check

# strict hardening (includes project-wide typecheck)
bun run hardening:strict
```

Notes:

- `doctor:runtime` fails fast if `CLAUDE_CODE_USE_OPENAI=1` with a placeholder key or a missing key for non-local providers.
- `doctor:runtime` also validates the dedicated Gemini and Mistral env paths when `CLAUDE_CODE_USE_GEMINI=1` or `CLAUDE_CODE_USE_MISTRAL=1`.
- Local providers such as `http://localhost:11434/v1`, `http://10.0.0.1:11434/v1`, and `http://127.0.0.1:1337/v1` can run without `OPENAI_API_KEY`.
- Codex profiles validate `CODEX_API_KEY` or the Codex CLI auth file and probe `POST /responses` instead of `GET /models`.
- `openclaude doctor report` is redacted by default and is intended for GitHub issues. It summarizes provider/runtime/build/settings state without prompts, transcripts, raw settings files, API keys, MCP command details, or full home-directory paths.
- `openclaude report --json` and `openclaude report --markdown` summarize observed session facts such as tool uses, Bash commands, validation commands, changed files, branch metadata, warnings, and linked issue/PR references. Use `--transcript <file>` for an explicit transcript, `--session <id>` for a stored session, or omit both to report the latest session for the current project. Large previews are truncated and credential-shaped strings are redacted. When no validation command is observed, the report keeps `validations` empty and includes a warning instead of claiming checks passed.

## Provider Launch Profiles

Use profile launchers to avoid repeated environment setup:

```bash
# one-time profile bootstrap (prefer viable local Ollama, otherwise OpenAI)
bun run profile:init

# preview the best provider/model for your goal
bun run profile:recommend -- --goal coding --benchmark

# auto-apply the best available local/openai provider/model for your goal
bun run profile:auto -- --goal latency

# codex bootstrap (defaults to codexplan and ~/.codex/auth.json)
bun run profile:codex

# openai bootstrap with explicit key
bun run profile:init -- --provider openai --api-key sk-...

# gemini bootstrap with explicit key
bun run profile:init -- --provider gemini --api-key ...

# ollama bootstrap with custom model
bun run profile:init -- --provider ollama --model llama3.1:8b

# ollama bootstrap with intelligent model auto-selection
bun run profile:init -- --provider ollama --goal coding

# atomic-chat bootstrap (auto-detects running model)
bun run profile:init -- --provider atomic-chat

# codex bootstrap with a fast model alias
bun run profile:init -- --provider codex --model codexspark

# launch using persisted user-level provider profile
bun run dev:profile

# codex profile (uses CODEX_API_KEY or ~/.codex/auth.json)
bun run dev:codex

# OpenAI profile (uses the saved OpenAI profile, or OPENAI_API_KEYS / OPENAI_API_KEY from your shell)
bun run dev:openai

# Gemini profile (uses the saved Gemini profile, or GEMINI_API_KEY / GOOGLE_API_KEY from your shell)
bun run dev:gemini

# Ollama profile (defaults: localhost:11434, llama3.1:8b)
bun run dev:ollama

# Atomic Chat profile (Apple Silicon local LLMs at 127.0.0.1:1337)
bun run dev:atomic-chat
```

`profile:recommend` ranks installed Ollama models for `latency`, `balanced`, or `coding`, and `profile:auto` can persist the recommendation directly.

If no profile exists yet, `dev:profile` uses the same goal-aware defaults when picking the initial model.

### Provider Profile Model Picker Mode

When a saved provider profile is active, `/model` can either show the provider's
catalog/discovered models or only the models explicitly listed in the profile.
Configure this in `~/.openclaude.json`:

```json
{
  "providerProfileModelPickerMode": "auto"
}
```

Supported values:

- `auto` (default): single-model profiles show the provider catalog; multi-model
  profiles show the explicit profile list; native vendor routes keep their full
  provider catalog.
- `provider`: show the provider catalog/discovery list first and append
  profile-only custom model IDs.
- `profile`: show only explicitly configured profile models.

When the provider-profile env workflow is active (i.e. a profile has been
applied and `CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED=1` is set — as it is after
launching with a saved profile) and you have more than one saved provider
profile, `/model` also lists models from your **inactive** profiles, grouped
under their profile name. Selecting one activates that provider profile and
switches to the chosen model in a single step, reconciling fast mode if the
target provider cannot run it. These cross-profile entries appear only in the
interactive `/model` picker — they are never returned to SDK/automation callers
and are hidden from inline pickers (such as the prompt hotkey or Settings),
which cannot switch the active profile. Simply having multiple profiles
configured without the env workflow active does not surface them.

Use `--provider ollama` when you want a local-only path. Auto mode falls back to OpenAI when no viable local chat model is installed.

Use `--provider atomic-chat` when you want Atomic Chat as the local Apple Silicon provider.

Use `profile:codex` or `--provider codex` when you want the ChatGPT Codex backend.

`dev:openai`, `dev:gemini`, `dev:ollama`, `dev:atomic-chat`, and `dev:codex`
run `doctor:runtime` first and only launch the app if checks pass.

For `dev:ollama`, make sure Ollama is running locally before launch.

For `dev:atomic-chat`, make sure Atomic Chat is running with a model loaded before launch.

## Message-Count Compaction Threshold

By default, OpenClaude compacts conversations based on token usage and also
applies a safety hard cap of 1000 active messages. The hard cap catches long
sessions that accumulate many small messages with negligible token cost.

This hard cap is a safety net: it can still trigger compaction even when
`DISABLE_COMPACT`, `DISABLE_AUTO_COMPACT`, or a disabled auto-compact setting
would otherwise prevent it. Set `OPENCLAUDE_MAX_ACTIVE_MESSAGES_HARD_CAP=0`
only when you need to suppress that safety cap for diagnostics.

If you frequently resume long sessions that accumulate hundreds of small
tool-result messages with negligible token cost, you can opt in to message-count
compaction via the in-app `/config` command:

```text
/config
```

Select **Message-count compaction** and choose a threshold (`100`, `200`, `500`,
or `1000`). Setting it to `off` (default) leaves only the built-in hard cap.

This setting is intended for power users debugging specific edge cases. Most
users should leave it at `off`.

The legacy `OPENCLAUDE_MAX_ACTIVE_MESSAGES` environment variable is still
honored when the setting is `off`. `OPENCLAUDE_MAX_ACTIVE_MESSAGES_HARD_CAP`
can override the safety cap; set it to `0` only for diagnostics.

### Long-session memory guard validation

For changes that touch auto-compact, provider request conversion, transcript
retention, or in-process teammates, run the focused long-session guard checks:

```bash
bun test --feature=UNATTENDED_RETRY src/query/autoCompactCooldown.test.ts src/utils/maxActiveMessages.test.ts src/services/api/openaiShim.test.ts
```

These tests cover repeated over-cap turns, auto-compact cooldown blocking,
teammate active-message compaction, malformed hard-cap overrides, and
pruned-history tool-call/tool-result pairing. They are not a substitute for a
multi-hour manual soak, but they pin the bounded-history and conversion
invariants that previously let long sessions grow until Node/V8 OOM.
