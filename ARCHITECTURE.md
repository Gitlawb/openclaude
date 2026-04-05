# OpenClaude — Architecture (Foundation Operations Fork)

> Fork of [Gitlawb/openclaude](https://github.com/Gitlawb/openclaude) — open-source Claude Code alternative supporting multiple LLM providers.

## Overview

OpenClaude is a terminal-first AI coding agent CLI. It provides Claude Code-style workflows (bash tools, file editing, grep, glob, agents, MCP, slash commands, streaming) while allowing any LLM backend.

## Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript |
| Build | Bun (bun install, bun run build) |
| Runtime | Node.js >= 20 (runs compiled dist/cli.mjs) |
| Terminal UI | React (Ink-style via react-reconciler) |
| Package | @gitlawb/openclaude on npm |

## Key Directories

| Path | Purpose |
|------|---------|
| src/ | TypeScript source |
| dist/ | Compiled output (cli.mjs) |
| bin/ | CLI entry points |
| scripts/ | Build and utility scripts |
| python/ | Python helper utilities |
| docs/ | Setup and usage documentation |
| vscode-extension/ | VS Code extension |

## Provider Configuration

Configured via environment variables. Currently using local Ollama:

| Variable | Value |
|----------|-------|
| CLAUDE_CODE_USE_OPENAI | 1 |
| OPENAI_BASE_URL | http://localhost:11434/v1 |
| OPENAI_MODEL | qwen2.5:7b |
| OPENAI_API_KEY | ollama |

Supports: Anthropic, OpenAI, Gemini, GitHub Models, Ollama, LM Studio, AWS Bedrock, Vertex AI, any OpenAI-compatible API.

## Deployment on VPS2

| Item | Value |
|------|-------|
| VPS | 187.124.248.8 (8 CPU / 32 GB RAM / 400 GB disk) |
| Install path | /opt/openclaude |
| Global command | openclaude (/usr/local/bin/openclaude wrapper) |
| Ollama | localhost:11434 with qwen2.5:7b |
| Config files | /opt/openclaude/.env, /root/.bashrc |

## Build & Run

# Install dependencies
bun install

# Build
bun run build

# Run interactively
openclaude

# One-shot query
openclaude --print "your prompt"

# Run tests
bun test

## Git

- Origin: https://github.com/foundationoperations/openclaude.git
- Upstream: https://github.com/Gitlawb/openclaude.git (add with git remote add upstream)

---

*Deployed: 2026-04-05*
