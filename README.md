# Verboo Code

Verboo Code is the coding-agent CLI for the [Verboo platform](https://code.verboo.ai). It connects exclusively to Verboo's infrastructure — no API keys from external providers needed.

[![PR Checks](https://github.com/verbeux-ai/code/actions/workflows/pr-checks.yml/badge.svg?branch=main)](https://github.com/verbeux-ai/code/actions/workflows/pr-checks.yml)
[![Release](https://img.shields.io/github/v/tag/verbeux-ai/code?label=release&color=0ea5e9)](https://github.com/verbeux-ai/code/tags)
[![Security Policy](https://img.shields.io/badge/security-policy-0f766e)](SECURITY.md)
[![License](https://img.shields.io/badge/license-MIT-2563eb)](LICENSE)

Verboo Code is a fork of [Claude Code](https://github.com/anthropics/claude-code), maintained by the Verboo team.

[Quick Start](#quick-start) | [What Works](#what-works) | [gRPC Server](#headless-grpc-server) | [Source Build](#source-build-and-local-development) | [Community](#community)

## Quick Start

### 1. Create an account

Sign up at [code.verboo.ai](https://code.verboo.ai).

### 2. Install

```bash
npm install -g @verboo/code
```

If the install later reports `ripgrep not found`, install ripgrep system-wide and confirm `rg --version` works in the same terminal before starting.

### 3. Run

```bash
verboo
```

On first run, Verboo Code opens your browser at `https://code.verboo.ai` to complete the OAuth login. Once authenticated, your session tokens are stored securely in the native adapter for your platform (macOS Keychain, Windows DPAPI protected per-user storage, or Linux libsecret). No additional configuration required.

To log in manually at any time:

```bash
verboo /login
```

## What Works

- **Tool-driven coding workflows**: Bash, file read/write/edit, grep, glob, agents, tasks, MCP, and slash commands
- **Streaming responses**: Real-time token output and tool progress
- **Tool calling**: Multi-step tool loops with model calls, tool execution, and follow-up responses
- **Images**: URL and base64 image inputs for providers that support vision

### Interrupting work

Press **Esc** once to stop work across the current CLI session, including
subagents and commands running in the background from earlier messages.
This also works while a menu, permission prompt, history search, or agent
transcript is open. Queued messages and attachments are kept; the queue resumes
when you submit a new message. Your draft input is preserved.

**Ctrl+C** also stops active work. With text selected, it keeps its copy behavior;
when the session is idle, the usual exit shortcut remains available.

## Verboo in Chrome

The Verboo desktop app installs and maintains the local `verboo-in-chrome` MCP
on macOS, Windows, and Linux. Configure it in **Settings > Integrations >
Chrome**. Once the managed MCP entry is present, the CLI connects to it
automatically and exposes the `verboo-in-chrome` skill for browser tasks.

Use `verboo --no-chrome` to disable the integration for one session,
`verboo --chrome` to require it for one session, and `/chrome` to inspect its
status. The transport stays local, does not copy CLI credentials into the
extension, and continues to enforce the extension's site permissions and
approval flow.

## Web Search and Fetch

`WebSearch` uses DuckDuckGo by default.

> **Note:** DuckDuckGo fallback works by scraping search results and may be rate-limited, blocked, or subject to DuckDuckGo's Terms of Service.

`WebFetch` works via basic HTTP plus HTML-to-markdown conversion. It may fail on JavaScript-rendered sites or sites that block plain HTTP requests.

## Agent Model Routing

Verboo resolves subagent models against the authenticated `/models` catalog and
preserves the complete server-provided ID, including plan prefixes such as
`max/qwen3.6-27b`. Router-provided `agent_model_roles` are authoritative; the
portable profiles below are compatibility fallbacks and can also be selected by
user-defined workers.

Configure agents in `~/.verboo/settings.json`:

```json
{
  "agentRouting": {
    "Explore": "fast",
    "worker-review": { "profile": "review" },
    "worker-backend": { "profile": "coding" },
    "worker-tests": { "profile": "testing" },
    "default": { "profile": "balanced" }
  }
}
```

Available profiles are `fast`, `review`, `coding`, `testing`, and `balanced`.
Each chooses a preferred model that is present in the logged-in account. If no
candidate is available, the worker inherits the parent model. A profile can opt
into the first catalog entry as a last resort with
`"fallback": "first-available"`.

Forked and inline skills support the same profiles:

```yaml
---
name: worker-review
model: profile:review
context: fork
---
```

An exact Verboo model can be requested without adding another API key. It is
used only when it exists in the authenticated catalog:

```json
{
  "agentRouting": {
    "worker-review": {
      "model": "deepseek-v4-pro",
      "provider": "inherit"
    }
  }
}
```

The legacy `agentModels` plus string `agentRouting` format for external
OpenAI-compatible providers remains supported.

---

## Headless gRPC Server

Verboo Code can be run as a headless gRPC service, allowing you to integrate its agentic capabilities (tools, bash, file editing) into other applications, CI/CD pipelines, or custom user interfaces. The server uses bidirectional streaming to send real-time text chunks, tool calls, and request permissions for sensitive commands.

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

*Note: The gRPC definitions are located in `src/proto/verboo.proto`. You can use this file to generate clients in Python, Go, Rust, or any other language.*

---

## Source Build And Local Development

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

Verboo Code uses Bun's built-in test runner for unit tests.

Run the full unit suite:

```bash
bun run test:isolated
```

Run the release quality gate with the Bun version pinned in `.bun-version` and
Node 22 or 24:

```bash
bun run test:quality
```

This builds and installs the npm package in an independent consumer directory,
runs every isolated test file, then exercises the installed CLI in real PTYs
against a local HTTP/SSE fixture. See [CLI quality checks](docs/cli-quality.md)
for the test matrix, artifacts and release requirements.

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

Coverage output is written to `coverage/lcov.info`, and Verboo Code also generates a git-activity-style heatmap at `coverage/index.html`.

## Repository Structure

- `src/` - core CLI/runtime
- `scripts/` - build, verification, and maintenance scripts
- `docs/` - setup, contributor, and project documentation
- `python/` - standalone Python helpers and their tests
- `vscode-extension/verboo-vscode/` - VS Code extension
- `.github/` - repo automation, templates, and CI configuration
- `bin/` - CLI launcher entrypoints

## Security

If you believe you found a security issue, see [SECURITY.md](SECURITY.md).

## Community

- Use [GitHub Issues](https://github.com/verbeux-ai/code/issues) for questions, confirmed bugs, and actionable feature work

## Contributing

Contributions are welcome.

For larger changes, open an issue first so the scope is clear before implementation. Helpful validation commands include:

- `bun run build`
- `bun run test:coverage`
- `bun run smoke`
- focused `bun test ...` runs for files and flows you changed

## Disclaimer

Verboo Code is an independent community project and is not affiliated with, endorsed by, or sponsored by Anthropic.

Verboo Code originated from the Claude Code codebase and has since been substantially modified. "Claude" and "Claude Code" are trademarks of Anthropic PBC. See [LICENSE](LICENSE) for details.

## License

See [LICENSE](LICENSE).

## Free-token accounting

`/usage` shows the number of requests awaiting usage confirmation and the
server-configured limit (10 by default). Live requests reserve a slot until their
usage is settled. Free inference pauses at the limit; paid activation remains
available with explicit confirmation, including during an ongoing conversation.
Older backend responses are supported. Non-interactive sessions never accept a payment.
