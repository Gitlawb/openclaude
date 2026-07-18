<div align="center">
  <img src="docs/assets/openclaude-wordmark.svg" alt="OpenClaude — Open terminal for any LLM" width="830">

  <p>
    <a href="https://trendshift.io/repositories/25807?utm_source=trendshift-badge&amp;utm_medium=badge&amp;utm_campaign=badge-trendshift-25807" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/trendshift/repositories/25807/daily?language=TypeScript" alt="Gitlawb%2Fopenclaude | Trendshift" width="250" height="55"/></a>
    <a href="https://trendshift.io/repositories/25807?utm_source=trendshift-badge&amp;utm_medium=badge&amp;utm_campaign=badge-trendshift-25807" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/trendshift/repositories/25807/monthly?language=TypeScript" alt="Gitlawb%2Fopenclaude | Trendshift" width="250" height="55"/></a>
    <a href="https://trendshift.io/repositories/25807?utm_source=repository-badge&amp;utm_medium=badge&amp;utm_campaign=badge-repository-25807" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/repositories/25807" alt="Gitlawb%2Fopenclaude | Trendshift" width="250" height="55"/></a>
  </p>
</div>

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

[Quick Start](#quick-start) | [Setup Guides](#setup-guides) | [Providers](#supported-providers) | [Development](#development) | [VS Code Extension](#vs-code-extension) | [Sponsors](#sponsors) | [Community](#community)

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

## Why OpenClaude

- One CLI across cloud APIs and local model backends — no per-provider tooling
- Guided provider setup and saved profiles with `/provider`
- Coding-agent workflows in one place: bash, file tools, grep, glob, agents, tasks, MCP, and web tools
- A bundled VS Code extension for launch integration and theme support
- A pixel-art hero companion who fires an arrow every time you press Enter (really — see [Meet your buddy](#meet-your-buddy))

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
- [Agent Routing and Step Limits](docs/agent-routing.md)
- [Headless gRPC Server](docs/grpc-server.md)
- [Repo Map (codebase intelligence)](docs/repo-map.md)
- [Android Install](ANDROID_INSTALL.md)

## Supported Providers

| Provider | Setup Path | Notes |
| --- | --- | --- |
| OpenAI-compatible | `/provider` or env vars | Works with OpenAI, OpenRouter, DeepSeek, Groq, Mistral, LM Studio, and other compatible `/v1` servers |
| Z.AI GLM Coding Plan | `/provider` or OpenAI-compatible env vars | Uses `OPENAI_API_KEY` at `https://api.z.ai/api/coding/paas/v4` and defaults to `glm-5.2` |
| AI/ML API | `/provider` or `AIMLAPI_API_KEY` ([setup guide](docs/aimlapi-setup.md)) | Uses `https://api.aimlapi.com/v1`, auto-detects the OpenAI-compatible route from `AIMLAPI_API_KEY`, sends OpenClaude attribution headers, and discovers chat-capable models from the public `/models` catalog |
| Hicap | `/provider` or OpenAI-compatible env vars | Uses `api-key` auth, discovers models from unauthenticated `/models`, and supports Responses mode for `gpt-` models |
| Fireworks AI | `/provider` or env vars | First-class provider with 276 curated models (DeepSeek, Qwen, Llama, Gemma, and more); uses `FIREWORKS_API_KEY` |
| LongCat | `/provider` or env vars | Meituan LongCat OpenAI-compatible API at `https://api.longcat.chat/openai/v1`; uses `LONGCAT_API_KEY` and defaults to `LongCat-2.0` |
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
- **A companion with signature moves**: A truecolor pixel-art hero who lives beside your prompt and reacts when you work. See below.

## Meet Your Buddy

Run `/buddy` to hatch a companion — a truecolor pixel-art hero who stands
beside your prompt, idles, blinks, and fires their signature move every time
you submit a message:

```
/buddy                  hatch (first run) or pet your companion
/buddy set robinhood    the green archer — arrow shot on every Enter
/buddy set kaio         gold-haired warrior — charges a full-width energy wave
/buddy set strawhat     stretchy punch that snaps back
/buddy set merlin       twinkling sparkle stream
/buddy set kage         spinning shuriken
/buddy set ember        dragon fire with a real heat gradient
/buddy set corsair      cannonball with smoke trail
/buddy name Robin       rename your companion
/buddy set random       back to your rolled hero
```

Companions respect `prefersReducedMotion`, degrade gracefully to line art in
low-color terminals, and can be silenced with `/buddy mute`. Requires a
terminal at least 100 columns wide for the full sprite.

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
- GitHub Copilot serializes sub-agent execution by default to reduce Premium Request consumption — see [Agent Routing and Step Limits](docs/agent-routing.md#github-copilot-sub-agent-optimization) for tuning

For best results, use models with strong tool/function calling support.

## Agents

Route different agents to different models (cost optimization, splitting work
by model strength), cap sub-agent tool steps with `maxSteps`, and tune GitHub
Copilot sub-agent behavior. All settings-driven:

- per-agent provider/model overrides via `agentModels` + `agentRouting` in `~/.openclaude.json`
- model-only routes that reuse your current provider's credentials
- built-in agents (`Explore`, `Plan`, `verification`) routable by type name

See [Agent Routing and Step Limits](docs/agent-routing.md) for the full guide.

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

## Headless gRPC Server

OpenClaude can run as a headless gRPC service with bidirectional streaming —
integrate its agentic capabilities into other applications, CI/CD pipelines,
or custom UIs. Start it with `npm run dev:grpc`; a test CLI client ships with
the repo. See [Headless gRPC Server](docs/grpc-server.md) for configuration
and client generation from `src/proto/openclaude.proto`.

## Development

Use Node.js `>=22.0.0` and Bun `1.3.13` or newer for source builds.

```bash
bun install
bun run build
node dist/cli.mjs
```

Day-to-day commands:

- `bun run dev` — build and launch from source
- `bun test` — full unit suite (Bun's built-in runner)
- `bun test path/to/file.test.ts` — focused runs for the areas you touch
- `bun run test:coverage` — coverage to `coverage/lcov.info` plus a visual report at `coverage/index.html` (`bun run test:coverage:ui` rebuilds just the UI)
- `bun run smoke` — smoke checks
- `bun run doctor:runtime`, `bun run verify:privacy`, `bun run security:pr-scan -- --base origin/main`

Focused suites: `bun run test:provider`, `bun run test:provider-recommendation`.

Recommended validation before opening a PR:

- `bun run build`
- `bun run smoke`
- `bun run test:coverage` when your change affects shared runtime or provider logic
- focused `bun test ...` runs for the files and flows you changed

## Repository Structure

- `src/` - core CLI/runtime
- `scripts/` - build, verification, and maintenance scripts
- `docs/` - setup, contributor, and project documentation
- `vscode-extension/openclaude-vscode/` - VS Code extension
- `.github/` - repo automation, templates, and CI configuration
- `bin/` - CLI launcher entrypoints

## VS Code Extension

The repo includes a VS Code extension in [`vscode-extension/openclaude-vscode`](vscode-extension/openclaude-vscode) for OpenClaude launch integration, provider-aware Control Center, in-editor chat, theme support, and optional **Microsoft Foundry / Azure OpenAI** configuration (endpoint, API version, deployment, API key via Secret Storage) injected into launched terminals. See that folder's [README](vscode-extension/openclaude-vscode/README.md).

## Security

If you believe you found a security issue, see [SECURITY.md](SECURITY.md).

## Community

- Use [GitHub Discussions](https://github.com/Gitlawb/openclaude/discussions) for Q&A, ideas, and community conversation
- Use [GitHub Issues](https://github.com/Gitlawb/openclaude/issues) for confirmed bugs and actionable feature work
- Join the [Discord](https://discord.gg/k68zFR6AcB) to chat with the community in real time
- Follow [@gitlawb on X](https://x.com/gitlawb) for updates and announcements

## Contributing

Contributions are welcome. For larger changes, open an issue first so the
scope is clear before implementation. See [Development](#development) for the
build, test, and pre-PR validation commands.

## Disclaimer

OpenClaude is an independent community project and is not affiliated with, endorsed by, or sponsored by Anthropic.

OpenClaude originated from the Claude Code codebase and has since been substantially modified to support multiple providers and open use. "Claude" and "Claude Code" are trademarks of Anthropic PBC. See [LICENSE](LICENSE) for details.

## License

MIT for OpenClaude contributors' modifications; the derived Claude Code remains Anthropic's. [See more](LICENSE).
