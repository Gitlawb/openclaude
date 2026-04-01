# OpenClaude

Use Claude Code with **any LLM** — not just Claude.

OpenClaude is a fork of the [Claude Code source leak](https://gitlawb.com/node/repos/z6MkgKkb/instructkr-claude-code) (exposed via npm source maps on March 31, 2026). We added an OpenAI-compatible provider shim so you can plug in GPT-4o, DeepSeek, Gemini, Llama, Mistral, or any model that speaks the OpenAI chat completions API.

All of Claude Code's tools work — bash, file read/write/edit, grep, glob, agents, tasks, MCP — just powered by whatever model you choose.

---

## Install

### Option A: npm (recommended)

```bash
npm install -g @gitlawb/openclaude
```

### Option B: From source (requires Bun)

```bash
# Clone from gitlawb
git clone https://node.gitlawb.com/z6MkqDnb7Siv3Cwj7pGJq4T5EsUisECqR8KpnDLwcaZq5TPr/openclaude.git
cd openclaude

# Install dependencies
bun install

# Build
bun run build

# Link globally (optional)
npm link
```

### Option C: Run directly with Bun (no build step)

```bash
git clone https://node.gitlawb.com/z6MkqDnb7Siv3Cwj7pGJq4T5EsUisECqR8KpnDLwcaZq5TPr/openclaude.git
cd openclaude
bun install
bun run dev
```

---

## Quick Start

### 1. Set 3 environment variables

```bash
export CLAUDE_CODE_USE_OPENAI=1
export OPENAI_API_KEY=sk-your-key-here
export OPENAI_MODEL=gpt-4o
```

### 2. Run it

```bash
# If installed via npm
openclaude

# If built from source
bun run dev
# or after build:
node dist/cli.mjs
```

That's it. The tool system, streaming, file editing, multi-step reasoning — everything works through the model you picked.

The npm package name is `@gitlawb/openclaude`, but the installed CLI command is still `openclaude`.

---

## Provider Examples

### OpenAI

```bash
export CLAUDE_CODE_USE_OPENAI=1
export OPENAI_API_KEY=sk-...
export OPENAI_MODEL=gpt-4o
```

### DeepSeek

```bash
export CLAUDE_CODE_USE_OPENAI=1
export OPENAI_API_KEY=sk-...
export OPENAI_BASE_URL=https://api.deepseek.com/v1
export OPENAI_MODEL=deepseek-chat
```

### Google Gemini (via OpenRouter)

```bash
export CLAUDE_CODE_USE_OPENAI=1
export OPENAI_API_KEY=sk-or-...
export OPENAI_BASE_URL=https://openrouter.ai/api/v1
export OPENAI_MODEL=google/gemini-2.0-flash
```

### Ollama (local, free)

```bash
ollama pull llama3.3:70b

export CLAUDE_CODE_USE_OPENAI=1
export OPENAI_BASE_URL=http://localhost:11434/v1
export OPENAI_MODEL=llama3.3:70b
# no API key needed for local models
```

### LM Studio (local)

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
export OPENAI_API_KEY=gsk_...
export OPENAI_BASE_URL=https://api.groq.com/openai/v1
export OPENAI_MODEL=llama-3.3-70b-versatile
```

### Mistral

```bash
export CLAUDE_CODE_USE_OPENAI=1
export OPENAI_API_KEY=...
export OPENAI_BASE_URL=https://api.mistral.ai/v1
export OPENAI_MODEL=mistral-large-latest
```


### Qwen / Alibaba Cloud (DashScope & Coding Plan)

```bash
# Using Alibaba Cloud Coding Plan - OpenAI API-Compatible
export CLAUDE_CODE_USE_OPENAI=1
export OPENAI_API_KEY=sk-your-coding-plan-key
export OPENAI_BASE_URL=https://coding-intl.dashscope.aliyuncs.com/v1
export OPENAI_MODEL=qwen3.5-plus
```

```bash
# Using Alibaba Cloud Coding Plan - Anthropic Protocol Compatible
export CLAUDE_CODE_USE_OPENAI=1
export OPENAI_API_KEY=sk-your-coding-plan-key
export OPENAI_BASE_URL=https://coding-intl.dashscope.aliyuncs.com/apps/anthropic
export OPENAI_MODEL=qwen3.5-plus
```

### Azure OpenAI

```bash
export CLAUDE_CODE_USE_OPENAI=1
export OPENAI_API_KEY=your-azure-key
export OPENAI_BASE_URL=https://your-resource.openai.azure.com/openai/deployments/your-deployment/v1
export OPENAI_MODEL=gpt-4o
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CLAUDE_CODE_USE_OPENAI` | Yes | Set to `1` to enable the OpenAI provider |
| `OPENAI_API_KEY` | Yes* | Your API key (*not needed for local models like Ollama) |
| `OPENAI_MODEL` | Yes | Model name (e.g. `gpt-4o`, `deepseek-chat`, `llama3.3:70b`) |
| `OPENAI_BASE_URL` | No | API endpoint (defaults to `https://api.openai.com/v1`) |

You can also use `ANTHROPIC_MODEL` to override the model name. `OPENAI_MODEL` takes priority.

---

## Runtime Hardening

Use these commands to keep the CLI stable and catch environment mistakes early:

```bash
# quick startup sanity check
bun run smoke

# validate provider env + reachability
bun run doctor:runtime

# print machine-readable runtime diagnostics
bun run doctor:runtime:json

# persist a diagnostics report to reports/doctor-runtime.json
bun run doctor:report

# full local hardening check (typecheck + smoke + runtime doctor)
bun run hardening:check

# strict hardening (includes project-wide typecheck)
bun run hardening:strict
```

Notes:
- `doctor:runtime` fails fast if `CLAUDE_CODE_USE_OPENAI=1` with a placeholder key (`SUA_CHAVE`) or a missing key for non-local providers.
- Local providers (for example `http://localhost:11434/v1`) can run without `OPENAI_API_KEY`.

### Provider Launch Profiles

Use profile launchers to avoid repeated environment setup:

```bash
# one-time profile bootstrap (auto-detect ollama, otherwise openai)
bun run profile:init

# openai bootstrap with explicit key
bun run profile:init -- --provider openai --api-key sk-...

# ollama bootstrap with custom model
bun run profile:init -- --provider ollama --model llama3.1:8b

# launch using persisted profile (.openclaude-profile.json)
bun run dev:profile

# OpenAI profile (requires OPENAI_API_KEY in your shell)
bun run dev:openai

# Ollama profile (defaults: localhost:11434, llama3.1:8b)
bun run dev:ollama
```

`dev:openai` and `dev:ollama` run `doctor:runtime` first and only launch the app if checks pass.
For `dev:ollama`, make sure Ollama is running locally before launch.

---

## What Works

- **All tools**: Bash, FileRead, FileWrite, FileEdit, Glob, Grep, WebFetch, WebSearch, Agent, MCP, LSP, NotebookEdit, Tasks
- **Streaming**: Real-time token streaming
- **Tool calling**: Multi-step tool chains (the model calls tools, gets results, continues)
- **Images**: Base64 and URL images passed to vision models
- **Slash commands**: /commit, /review, /compact, /diff, /doctor, etc.
- **Sub-agents**: AgentTool spawns sub-agents using the same provider
- **Memory**: Persistent memory system

## What's Different

- **No thinking mode**: Anthropic's extended thinking is disabled (OpenAI models use different reasoning)
- **No prompt caching**: Anthropic-specific cache headers are skipped
- **No beta features**: Anthropic-specific beta headers are ignored
- **Token limits**: Defaults to 32K max output — some models may cap lower, which is handled gracefully

---

## How It Works

The shim (`src/services/api/openaiShim.ts`) sits between Claude Code and the LLM API:

```
Claude Code Tool System
        |
        v
  Anthropic SDK interface (duck-typed)
        |
        v
  openaiShim.ts  <-- translates formats
        |
        v
  OpenAI Chat Completions API
        |
        v
  Any compatible model
```

It translates:
- Anthropic message blocks → OpenAI messages
- Anthropic tool_use/tool_result → OpenAI function calls
- OpenAI SSE streaming → Anthropic stream events
- Anthropic system prompt arrays → OpenAI system messages

The rest of Claude Code doesn't know it's talking to a different model.

---

## Model Quality Notes

Not all models are equal at agentic tool use. Here's a rough guide:

| Model | Tool Calling | Code Quality | Speed |
|-------|-------------|-------------|-------|
| GPT-4o | Excellent | Excellent | Fast |
| DeepSeek-V3 | Great | Great | Fast |
| Gemini 2.0 Flash | Great | Good | Very Fast |
| Llama 3.3 70B | Good | Good | Medium |
| Mistral Large | Good | Good | Fast |
| GPT-4o-mini | Good | Good | Very Fast |
| Qwen 3.5 Plus | Great | Excellent | Medium-Fast |
| Qwen 3 Coder Plus | Excellent | Excellent | Medium |
| Qwen 3 Coder Next | Great | Great | Fast |
| Qwen 2.5 72B | Good | Good | Medium |
| Smaller models (<7B) | Limited | Limited | Very Fast |

For best results, use models with strong function/tool calling support.

---

## Files Changed from Original

```
src/services/api/openaiShim.ts   — NEW: OpenAI-compatible API shim (724 lines)
src/services/api/client.ts       — Routes to shim when CLAUDE_CODE_USE_OPENAI=1
src/utils/model/providers.ts     — Added 'openai' provider type
src/utils/model/configs.ts       — Added openai model mappings
src/utils/model/model.ts         — Respects OPENAI_MODEL for defaults
src/utils/auth.ts                — Recognizes OpenAI as valid 3P provider
```

6 files changed. 786 lines added. Zero dependencies added.

---

## Origin

This is a fork of [instructkr/claude-code](https://gitlawb.com/node/repos/z6MkgKkb/instructkr-claude-code), which mirrored the Claude Code source snapshot that became publicly accessible through an npm source map exposure on March 31, 2026.

The original Claude Code source is the property of Anthropic. This repository is not affiliated with or endorsed by Anthropic.

---

## License

This repository is provided for educational and research purposes. The original source code is subject to Anthropic's terms. The OpenAI shim additions are public domain.
