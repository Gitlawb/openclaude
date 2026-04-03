# OpenClaude

OpenClaude is an open-source coding-agent CLI that works with more than one model provider.

Use OpenAI-compatible APIs, Gemini, GitHub Models, Codex, Ollama, Atomic Chat, and other supported backends while keeping the same terminal-first workflow: prompts, tools, agents, MCP, slash commands, and streaming output.

## Why OpenClaude

- Use one CLI across cloud and local model providers
- Save provider profiles inside the app with `/provider`
- Run locally with Ollama or Atomic Chat
- Keep core coding-agent workflows: bash, file tools, grep, glob, agents, tasks, MCP, and web tools

---

## Quick Start

### Install

```bash
npm install -g @gitlawb/openclaude
```

If the npm install path later reports `ripgrep not found`, install ripgrep system-wide and confirm `rg --version` works in the same terminal before starting OpenClaude.

### Start

```bash
openclaude
```

Inside OpenClaude:

- run `/provider` for guided setup of OpenAI-compatible, Gemini, Ollama, or Codex profiles
- run `/onboard-github` for GitHub Models setup

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

---

## Setup Guides

Beginner-friendly guides:

- [Non-Technical Setup](docs/non-technical-setup.md)
- [Windows Quick Start](docs/quick-start-windows.md)
- [macOS / Linux Quick Start](docs/quick-start-mac-linux.md)

Advanced and source-build guides:

- [Advanced Setup](docs/advanced-setup.md)
- [Android Install](ANDROID_INSTALL.md)

---

## Supported Providers

| Provider | Setup Path | Notes |
| --- | --- | --- |
| OpenAI-compatible | `/provider` or env vars | Works with OpenAI, OpenRouter, DeepSeek, Groq, Mistral, LM Studio, and compatible local `/v1` servers |
| Gemini | `/provider` or env vars | Google Gemini support through the runtime provider layer |
| GitHub Models | `/onboard-github` | Interactive onboarding with saved credentials |
| Codex | `/provider` | Uses existing Codex credentials when available |
| Ollama | `/provider` or env vars | Local inference with no API key |
| Atomic Chat | advanced setup | Local Apple Silicon backend |
| Bedrock / Vertex / Foundry | env vars | Additional provider integrations for supported environments |

---

## What Works

- Tool-driven coding workflows
  Bash, file read/write/edit, grep, glob, agents, tasks, MCP, and slash commands
- Streaming responses
  Real-time token output and tool progress
- Tool calling
  Multi-step tool loops with model calls, tool execution, and follow-up responses
- Images
  URL and base64 image inputs for providers that support vision
- Provider profiles
  Guided setup plus saved `.openclaude-profile.json` support
- Local and remote model backends
  Cloud APIs, local servers, and Apple Silicon local inference

---

## Provider Notes

OpenClaude supports multiple providers, but behavior is not identical across all of them.

- Anthropic-specific features may not exist on other providers
- Tool quality depends heavily on the selected model
- Smaller local models can struggle with long multi-step tool flows
- Some providers impose lower output caps than the CLI defaults, and OpenClaude adapts where possible

For best results, use models with strong tool/function calling support.

---

## Web Search and Fetch

`WebFetch` works out of the box.

`WebSearch` and richer JS-aware fetching work best with a Firecrawl API key:

```bash
export FIRECRAWL_API_KEY=your-key-here
```

With Firecrawl enabled:

- `WebSearch` is available across more provider setups
- `WebFetch` can handle JavaScript-rendered pages more reliably

Firecrawl is optional. Without it, OpenClaude falls back to the built-in behavior.

---

## Source Build

```bash
bun install
bun run build
node dist/cli.mjs
```

Helpful commands:

- `bun run dev`
- `bun run smoke`
- `bun run doctor:runtime`

---

## VS Code Extension

The repo includes a VS Code extension in [`vscode-extension/openclaude-vscode`](vscode-extension/openclaude-vscode) for OpenClaude launch integration and theme support.

---

## Security

If you believe you found a security issue, see [SECURITY.md](SECURITY.md).

---

## Contributing

Contributions are welcome.

For larger changes, open an issue first so the scope is clear before implementation. Helpful validation commands include:

- `bun run build`
- `bun run smoke`
- focused `bun test ...` runs for touched areas

---

## Disclaimer

OpenClaude is an independent community project and is not affiliated with, endorsed by, or sponsored by Anthropic.

"Claude" and "Claude Code" are trademarks of Anthropic.

---

## License

MIT
