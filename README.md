# OpenClaude

OpenClaude is an open-source coding-agent CLI for cloud and local model providers.

Use OpenAI-compatible APIs, Gemini, GitHub Models, Codex OAuth, Codex, Ollama, Atomic Chat, and other supported backends while keeping one terminal-first workflow: prompts, tools, agents, MCP, slash commands, and streaming output.

[![PR Checks](https://github.com/Gitlawb/openclaude/actions/workflows/pr-checks.yml/badge.svg?branch=main)](https://github.com/Gitlawb/openclaude/actions/workflows/pr-checks.yml)
[![Release](https://img.shields.io/github/v/tag/Gitlawb/openclaude?label=release&color=0ea5e9)](https://github.com/Gitlawb/openclaude/tags)
[![Discussions](https://img.shields.io/badge/discussions-open-7c3aed)](https://github.com/Gitlawb/openclaude/discussions)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.gg/k68zFR6AcB)
[![X](https://img.shields.io/badge/X-@gitlawb-000000?logo=x&logoColor=white)](https://x.com/gitlawb)
[![Security Policy](https://img.shields.io/badge/security-policy-0f766e)](SECURITY.md)
[![License](https://img.shields.io/badge/license-MIT-2563eb)](LICENSE)

OpenClaude is also mirrored to GitLawb:
[gitlawb.com/node/repos/z6MkqDnb/openclaude](https://gitlawb.com/node/repos/z6MkqDnb/openclaude)

[Quick Start](#quick-start) | [Setup Guides](#setup-guides) | [Providers](#supported-providers) | [Source Build](#source-build-and-local-development) | [VS Code Extension](#vs-code-extension) | [Sponsors](#sponsors) | [Community](#community)

## Sponsors

<table align="center">
  <tr>
    <td align="center" width="150" height="80">
      <a href="https://gitlawb.com">
        <img src="https://gitlawb.com/logo.png" alt="GitLawb logo" width="72">
      </a>
    </td>
    <td align="center" width="150" height="80">
      <a href="https://bankr.bot">
        <img src="https://bankr.bot/favicon.svg" alt="Bankr.bot logo" width="72">
      </a>
    </td>
    <td align="center" width="150" height="80">
      <a href="https://atomic.chat/">
        <img src="docs/assets/atomic-chat-logo.png" alt="Atomic Chat logo" width="72">
      </a>
    </td>
    <td align="center" width="150" height="80">
      <a href="https://mimo.mi.com">
        <img src="https://mimo.xiaomi.com/mimo-v2-pro/assets/logo.svg" alt="Xiaomi MiMo logo" width="136">
      </a>
    </td>
    <td align="center" width="150" height="80">
      <a href="https://www.atlascloud.ai/">
        <img src="docs/assets/atlas-cloud-banner.png" alt="Atlas Cloud logo" width="136">
      </a>
    </td>
  </tr>
  <tr>
    <td align="center"><a href="https://gitlawb.com"><strong>GitLawb</strong></a></td>
    <td align="center"><a href="https://bankr.bot"><strong>Bankr.bot</strong></a></td>
    <td align="center"><a href="https://atomic.chat/"><strong>Atomic Chat</strong></a></td>
    <td align="center"><a href="https://mimo.mi.com"><strong>Xiaomi MiMo</strong></a></td>
    <td align="center"><a href="https://www.atlascloud.ai/"><strong>Atlas Cloud</strong></a></td>
  </tr>
</table>

## Star History

[![Star History Chart](https://api.star-history.com/chart?repos=gitlawb/openclaude&type=date&legend=top-left)](https://www.star-history.com/?repos=gitlawb%2Fopenclaude&type=date&legend=top-left)

## Why OpenClaude

- Use one CLI across cloud APIs and local model backends
- Save provider profiles inside the app with `/provider`
- Run with OpenAI-compatible services, Gemini, GitHub Models, Codex OAuth, Codex, Ollama, Atomic Chat, and other supported providers
- Keep coding-agent workflows in one place: bash, file tools, grep, glob, agents, tasks, MCP, and web tools
- Use the bundled VS Code extension for launch integration and theme support

## Quick Start

### Install

OpenClaude requires Node.js `>=22.0.0` for npm installs and runtime. Bun is
only needed for source builds and local development.

```bash
npm install -g @gitlawb/openclaude@latest
```

If you're on Arch Linux, you can install OpenClaude from the community-maintained [AUR package](https://aur.archlinux.org/packages/openclaude):
```bash
paru -S openclaude
```

If the install later reports `ripgrep not found`, install ripgrep system-wide and confirm `rg --version` works in the same terminal before starting OpenClaude.

**Verify / troubleshoot installed version:**

```bash
openclaude --version
npm view @gitlawb/openclaude dist-tags
npm install -g @gitlawb/openclaude@latest
```

### Start

```bash
openclaude
```

Inside OpenClaude:

- run `/provider` for guided provider setup and saved profiles
- run `/onboard-github` for GitHub Models onboarding

> **Note:** OpenClaude does not automatically load project `.env` files. We recommend using the `/provider` command for setup, which saves provider profiles and credentials in `.openclaude-profile.json`. If you prefer environment variables, export them explicitly or run `openclaude --provider-env-file .env` for provider/setup variables. Export runtime/debug knobs from your shell or launcher.

### Resume or fork a conversation

Resume an existing conversation by session ID, or continue the most recent
conversation in the current directory:

```bash
openclaude --resume <session-id>
openclaude --continue
```

Add `--fork-session` to branch the conversation history into a new session ID
instead of reusing the original transcript:

```bash
openclaude --resume <session-id> --fork-session
openclaude --continue --fork-session
```

Forking is conversation branching only. It does not create filesystem isolation,
copy your working tree, or create a git worktree branch.

### Background sessions

Run long non-interactive prompts detached from the current terminal:

```bash
openclaude --bg "fix failing tests"
openclaude --bg --name auth-refactor "refactor auth middleware"
openclaude ps
openclaude logs auth-refactor
openclaude logs auth-refactor -f
openclaude kill auth-refactor
```

Background sessions are local child processes. OpenClaude does not start a daemon
or network service, and permission/provider/model/settings flags are passed to
the child process the same way they are for a foreground `--print` run. Session
metadata and logs are stored under the resolved OpenClaude config directory,
usually `~/.openclaude/bg-sessions/`; `OPENCLAUDE_CONFIG_DIR` can point
OpenClaude somewhere else. `CLAUDE_CONFIG_DIR` is ignored for OpenClaude
background-session storage. Session names can be reused after older sessions
reach a terminal state; use the session ID to inspect older logs with the same
name.

`openclaude attach <id-or-name>` currently reports the matching session and
points to `openclaude logs <id> -f`; full terminal reattach is not implemented
for local background sessions yet.

### OpenClaude config cutover

OpenClaude stores its own config under `~/.openclaude` and `~/.openclaude.json`
by default. It does not read `~/.claude`, project `.claude/` directories, or
`CLAUDE_CONFIG_DIR`; new users can start with an empty OpenClaude config and do
not need Claude Code installed.

If you previously used OpenClaude with `.claude` paths, migrate intentionally:
copy only the settings, commands, agents, skills, scheduled tasks, or other files
you personally created for OpenClaude into the matching `.openclaude` location.
Do not blanket-copy `.claude`, and do not copy Claude Code credentials or auth
files. For provider authentication, prefer running OpenClaude's provider setup
again or exporting provider-specific environment variables.

### Fastest OpenAI setup

macOS / Linux:

```bash
export CLAUDE_CODE_USE_OPENAI=1
export OPENAI_API_KEY=sk-your-key-here
export OPENAI_MODEL=gpt-4o

openclaude
```

Windows PowerShell:

```powershell
$env:CLAUDE_CODE_USE_OPENAI="1"
$env:OPENAI_API_KEY="sk-your-key-here"
$env:OPENAI_MODEL="gpt-4o"

openclaude
```

### Fastest local Ollama setup

macOS / Linux:

```bash
export CLAUDE_CODE_USE_OPENAI=1
export OPENAI_BASE_URL=http://localhost:11434/v1
export OPENAI_MODEL=qwen2.5-coder:7b

openclaude
```

Windows PowerShell:

```powershell
$env:CLAUDE_CODE_USE_OPENAI="1"
$env:OPENAI_BASE_URL="http://localhost:11434/v1"
$env:OPENAI_MODEL="qwen2.5-coder:7b"

openclaude
```

For Ollama, OpenClaude uses Ollama's native chat API and requests a 32768-token
context window on each chat request so same-session history is not silently
truncated by Ollama's OpenAI-compatible shim. Set `OPENCLAUDE_OLLAMA_NUM_CTX`
or `OLLAMA_CONTEXT_LENGTH` if you need a different request-level context size.
See [Advanced Setup](docs/advanced-setup.md#ollama-context-length) for
verification with `ollama ps`.

## Setup Guides

Beginner-friendly guides:

- [Non-Technical Setup](docs/non-technical-setup.md)
- [Windows Quick Start](docs/quick-start-windows.md)
- [macOS / Linux Quick Start](docs/quick-start-mac-linux.md)

Advanced and source-build guides:

- [Advanced Setup](docs/advanced-setup.md)
- [Smart Auto-Routing](docs/smart-routing.md)
- [Android Install](ANDROID_INSTALL.md)

## Supported Providers

| Provider | Setup Path | Notes |
| --- | --- | --- |
| OpenAI-compatible | `/provider` or env vars | Works with OpenAI, OpenRouter, DeepSeek, Groq, Mistral, LM Studio, and other compatible `/v1` servers |
| Z.AI GLM Coding Plan | `/provider` or OpenAI-compatible env vars | Uses `OPENAI_API_KEY` at `https://api.z.ai/api/coding/paas/v4` and defaults to `glm-5.2` |
| AI/ML API | `/provider` or `AIMLAPI_API_KEY` ([setup guide](docs/aimlapi-setup.md)) | Uses `https://api.aimlapi.com/v1`, auto-detects the OpenAI-compatible route from `AIMLAPI_API_KEY`, sends OpenClaude attribution headers, and discovers chat-capable models from the public `/models` catalog |
| Hicap | `/provider` or OpenAI-compatible env vars | Uses `api-key` auth, discovers models from unauthenticated `/models`, and supports Responses mode for `gpt-` models |
| Fireworks AI | `/provider` or env vars | First-class provider with 276 curated models (DeepSeek, Qwen, Llama, Gemma, and more); uses `FIREWORKS_API_KEY` |
| ClinePass | `/provider` or env vars | AI model gateway with usage limits (5hr, weekly, monthly); uses `CLINE_API_KEY` at `https://api.cline.bot/api/v1` |
| Gemini | `/provider` or env vars | Supports API key only |
| GitHub Models | `/onboard-github` | Interactive onboarding with saved credentials |
| Codex OAuth | `/provider` | Opens ChatGPT sign-in in your browser and stores Codex credentials securely |
| Codex | `/provider` | Uses existing Codex CLI auth, OpenClaude secure storage, or env credentials |
| Gitlawb Opengateway | Startup default, `/provider`, or env vars | Smart gateway at `https://opengateway.gitlawb.com/v1`; requires an API key from https://gitlawb.com/opengateway/keys and routes Xiaomi MiMo and GMI Cloud partner models by `OPENAI_MODEL` |
| OpenCode Zen | `/provider` or env vars | Pay-as-you-go AI gateway (48 models); uses `OPENCODE_API_KEY` via `https://opencode.ai/zen/v1`; shared key with OpenCode Go |
| OpenCode Go | `/provider` or env vars | $10/mo subscription for open models (13 models); uses `OPENCODE_API_KEY` via `https://opencode.ai/zen/go/v1`; shared key with OpenCode Zen |
| Xiaomi MiMo | `/provider` or env vars | OpenAI-compatible API at `https://mimo.mi.com`; uses `MIMO_API_KEY` and defaults to `mimo-v2.5-pro` |
| NEAR AI | `/provider` or env vars | Unified gateway (Claude, GPT, Gemini + TEE open models); uses `NEARAI_API_KEY` at `https://cloud-api.near.ai/v1` |
| Cloudflare Workers AI | `/provider` or env vars | OpenAI-compatible API at `https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/v1`; uses `CLOUDFLARE_API_TOKEN`. Replace `<ACCOUNT_ID>` with your Cloudflare account id. |
| Ollama | `/provider` or env vars | Local inference with no API key |
| Atomic Chat | `/provider`, env vars, or `bun run dev:atomic-chat` | Local Model Provider; auto-detects loaded models |
| Bedrock / Vertex / Foundry | env vars | Anthropic-family cloud routes; Vertex is for Claude on Vertex AI, not arbitrary Model Garden models |

## What Works

- **Tool-driven coding workflows**: Bash, file read/write/edit, grep, glob, agents, tasks, MCP, and slash commands
- **Streaming responses**: Real-time token output and tool progress
- **Tool calling**: Multi-step tool loops with model calls, tool execution, and follow-up responses
- **Images**: URL and base64 image inputs for providers that support vision
- **Provider profiles**: Guided setup plus saved user-level provider profile support
- **Local and remote model backends**: Cloud APIs, local servers, and Apple Silicon local inference
- **Codebase intelligence (repo map)**: Structural map of the repository ranked by PageRank importance, auto-injected into context when the `REPO_MAP` flag is enabled or the `REPO_MAP` environment variable is set. Inspect with `/repomap` (2048-token default). See [docs/repo-map.md](docs/repo-map.md) for details.

## Provider Notes

OpenClaude supports multiple providers, but behavior is not identical across all of them.

- Anthropic-specific features may not exist on other providers
- Tool quality depends heavily on the selected model
- Smaller local models can struggle with long multi-step tool flows
- Some providers impose lower output caps than the CLI defaults, and OpenClaude adapts where possible
- AI/ML API uses the OpenAI-compatible route, defaults to `gpt-4o`, and only surfaces chat-capable models from its public catalog
- Gitlawb Opengateway is the fresh-install startup default and requires an API key from https://gitlawb.com/opengateway/keys. It uses one OpenAI-compatible base URL; switch between `mimo-*` and `google/gemini-3.1-flash-lite-preview` with `/model`, and do not pin the base URL to `/v1/xiaomi-mimo`.
- Z.AI GLM Coding Plan uses `https://api.z.ai/api/coding/paas/v4` with `glm-5.2` by default. Use `glm-5.2?reasoning=high` for enhanced reasoning, `glm-5.2?reasoning=xhigh` to request Z.AI `reasoning_effort=max`, or `glm-5.2?thinking=disabled` for faster direct answers.
- Xiaomi MiMo uses `api-key` header auth on the direct OpenAI-compatible route and currently does not support `/usage` reporting in OpenClaude

### GitHub Copilot sub-agent optimization

When CLAUDE_CODE_USE_GITHUB=1, OpenClaude serializes sub-agent execution to reduce GitHub Copilot Premium Request consumption. Default behavior is GITHUB_COPILOT_MAX_SUBAGENTS=1 (synchronous, one sub-agent at a time). Tuning vars (all optional):

| Var | Effect |
|---|---|
| GITHUB_COPILOT_MAX_SUBAGENTS=0 | Suppress sub-agents entirely (sub-agents throw an error). |
| GITHUB_COPILOT_MAX_SUBAGENTS=1 | Force synchronous execution. **Default.** |
| GITHUB_COPILOT_MAX_SUBAGENTS=2..10 | Parsed/clamped but not enforced differently from =1 (any positive cap = synchronous). |
| GITHUB_COPILOT_ALLOW_SUBAGENTS=1 | Re-enable parallel/background sub-agents, overriding the cap. |
| GITHUB_COPILOT_FORCE_SYNC_SUBAGENTS=1 | Force synchronous execution regardless of cap. |
| GITHUB_COPILOT_OPTIMIZATION_DISABLED=1 | Disable all of the above; sub-agents run as before this feature. |

The `is_async` field reported in the `tengu_agent_tool_selected` event and the agent metadata now reflects the final execution mode (i.e., `false` when synchronous is forced). See `.env.example` for the full descriptions.

For best results, use models with strong tool/function calling support.

### Agent step limits

Custom agents can define `maxSteps` as a positive integer to cap how many tool-use steps a sub-agent may execute. When the limit is reached, OpenClaude stops additional tool calls and asks the sub-agent for a concise final summary covering completed work, findings, remaining tasks, and whether another run is needed. Omitting `maxSteps`, or setting it to an invalid value such as `0` or malformed input, preserves the default unlimited behavior.

```markdown
---
name: bounded-researcher
description: Use for focused research with bounded tool use
maxSteps: 8
---

You are a focused research agent.
```

## Agent Routing

OpenClaude can route different agents to different models through settings-based routing. This is useful for cost optimization or splitting work by model strength.

Add to `~/.openclaude.json`:

```json
{
  "agentModels": {
    "deepseek-v4-flash": {
      "base_url": "https://api.deepseek.com/v1",
      "api_key": "sk-your-key"
    },
    "zai-default": {
      "model": "glm-5.2",
      "base_url": "https://api.z.ai/api/coding/paas/v4",
      "api_key": "sk-your-key"
    },
    "gpt-4o": {
      "base_url": "https://api.openai.com/v1",
      "api_key": "sk-your-key"
    }
  },
  "agentRouting": {
    "Explore": "deepseek-v4-flash",
    "Plan": "gpt-4o",
    "general-purpose": "gpt-4o",
    "frontend-dev": "zai-default",
    "default": "gpt-4o"
  }
}
```

When no routing match is found, the global provider remains the fallback.

`agentRouting` values and explicit Agent tool `model` overrides match keys in `agentModels`. By default, that key is also the model string sent to the provider. Set `agentModels.<key>.model` when you want a local route key such as `zai-default` to call a different provider model name such as `glm-5.2`.

> **Note:** `/provider` changes the global/parent provider for your current session. `agentModels` and `agentRouting` are specifically for configuring per-agent provider overrides while keeping the parent session unchanged.

> **Note:** `api_key` values in `settings.json` are stored in plaintext. Keep this file private and do not commit it to version control.

**Model-only routes (same provider):** Omit `base_url` and `api_key` to run an agent on a different model using your *current* provider's endpoint and key — no credential duplication:

```json
{
  "agentModels": {
    "mini": { "model": "gpt-5-mini" }
  },
  "agentRouting": {
    "verification": "mini"
  }
}
```

**Built-in agents are routable by their type name.** Useful keys: `verification` (the read-only auditor that runs before completion), `Explore`, and `Plan`. For example, `"agentRouting": { "verification": "mini" }` runs the verifier on `gpt-5-mini` while your main session stays on its model. Absent any entry, the verifier inherits the main-loop model.

## Web Search and Fetch

By default, `WebSearch` works on non-Anthropic models using DuckDuckGo. This gives GPT-4o, DeepSeek, Gemini, Ollama, and other OpenAI-compatible providers a free web search path out of the box.

> **Note:** DuckDuckGo fallback works by scraping search results and may be rate-limited, blocked, or subject to DuckDuckGo's Terms of Service. If you want a more reliable supported option, configure Firecrawl.

For Anthropic-native backends and Codex responses, OpenClaude keeps the native provider web search behavior.

`WebFetch` works, but its basic HTTP plus HTML-to-markdown path can still fail on JavaScript-rendered sites or sites that block plain HTTP requests.

Set a [Firecrawl](https://firecrawl.dev) API key if you want Firecrawl-powered search/fetch behavior:

```bash
export FIRECRAWL_API_KEY=your-key-here
```

With Firecrawl enabled:

- `WebSearch` can use Firecrawl's search API while DuckDuckGo remains the default free path for non-Claude models
- `WebFetch` uses Firecrawl's scrape endpoint instead of raw HTTP, handling JS-rendered pages correctly

Free tier at [firecrawl.dev](https://firecrawl.dev) includes 500 credits. The key is optional.

---

## Headless gRPC Server

OpenClaude can be run as a headless gRPC service, allowing you to integrate its agentic capabilities (tools, bash, file editing) into other applications, CI/CD pipelines, or custom user interfaces. The server uses bidirectional streaming to send real-time text chunks, tool calls, and request permissions for sensitive commands.

### 1. Start the gRPC Server

Start the core engine as a gRPC service on `localhost:50051`:

```bash
npm run dev:grpc
```

#### Configuration

| Variable | Default | Description |
|-----------|-------------|------------------------------------------------|
| `GRPC_PORT` | `50051` | Port the gRPC server listens on |
| `GRPC_HOST` | `localhost` | Bind address. Use `0.0.0.0` to expose on all interfaces (not recommended without authentication) |

### 2. Run the Test CLI Client

We provide a lightweight CLI client that communicates exclusively over gRPC. It acts just like the main interactive CLI, rendering colors, streaming tokens, and prompting you for tool permissions (y/n) via the gRPC `action_required` event.

In a separate terminal, run:

```bash
npm run dev:grpc:cli
```

*Note: The gRPC definitions are located in `src/proto/openclaude.proto`. You can use this file to generate clients in Python, Go, Rust, or any other language.*

---

## Source Build And Local Development

Use Node.js `>=22.0.0` and Bun `1.3.13` or newer for source builds.

```bash
bun install
bun run build
node dist/cli.mjs
```

Helpful commands:

- `bun run dev`
- `bun test`
- `bun run test:coverage`
- `bun run security:pr-scan -- --base origin/main`
- `bun run smoke`
- `bun run doctor:runtime`
- `bun run verify:privacy`
- focused `bun test ...` runs for the areas you touch

## Testing And Coverage

OpenClaude uses Bun's built-in test runner for unit tests.

Run the full unit suite:

```bash
bun test
```

Generate unit test coverage:

```bash
bun run test:coverage
```

Open the visual coverage report:

```bash
open coverage/index.html
```

If you already have `coverage/lcov.info` and only want to rebuild the UI:

```bash
bun run test:coverage:ui
```

Use focused test runs when you only touch one area:

- `bun run test:provider`
- `bun run test:provider-recommendation`
- `bun test path/to/file.test.ts`

Recommended contributor validation before opening a PR:

- `bun run build`
- `bun run smoke`
- `bun run test:coverage` for broader unit coverage when your change affects shared runtime or provider logic
- focused `bun test ...` runs for the files and flows you changed

Coverage output is written to `coverage/lcov.info`, and OpenClaude also generates a git-activity-style heatmap at `coverage/index.html`.
## Repository Structure

- `src/` - core CLI/runtime
- `scripts/` - build, verification, and maintenance scripts
- `docs/` - setup, contributor, and project documentation
- `vscode-extension/openclaude-vscode/` - VS Code extension
- `.github/` - repo automation, templates, and CI configuration
- `bin/` - CLI launcher entrypoints

## VS Code Extension

The repo includes a VS Code extension in [`vscode-extension/openclaude-vscode`](vscode-extension/openclaude-vscode) for OpenClaude launch integration, provider-aware Control Center, in-editor chat, theme support, and optional **Microsoft Foundry / Azure OpenAI** configuration (endpoint, API version, deployment, API key via Secret Storage) injected into launched terminals. See that folder’s [README](vscode-extension/openclaude-vscode/README.md).

## Security

If you believe you found a security issue, see [SECURITY.md](SECURITY.md).

## Community

- Use [GitHub Discussions](https://github.com/Gitlawb/openclaude/discussions) for Q&A, ideas, and community conversation
- Use [GitHub Issues](https://github.com/Gitlawb/openclaude/issues) for confirmed bugs and actionable feature work
- Join the [Discord](https://discord.gg/k68zFR6AcB) to chat with the community in real time
- Follow [@gitlawb on X](https://x.com/gitlawb) for updates and announcements

## Contributing

Contributions are welcome.

For larger changes, open an issue first so the scope is clear before implementation. Helpful validation commands include:

- `bun run build`
- `bun run test:coverage`
- `bun run smoke`
- focused `bun test ...` runs for files and flows you changed


## Disclaimer

OpenClaude is an independent community project and is not affiliated with, endorsed by, or sponsored by Anthropic.

OpenClaude originated from the Claude Code codebase and has since been substantially modified to support multiple providers and open use. "Claude" and "Claude Code" are trademarks of Anthropic PBC. See [LICENSE](LICENSE) for details.

## License

MIT for OpenClaude contributors' modifications; the derived Claude Code remains Anthropic's. [See more](LICENSE).
