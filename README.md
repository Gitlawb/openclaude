# 🦆 DuckHive

![DuckHive](https://img.shields.io/badge/DuckHive-v0.6.0-gold?style=for-the-badge&logo=buymeacoffee)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue?style=for-the-badge&logo=typescript)](package.json)
[![Bun](https://img.shields.io/badge/Bun-1.1-yellow?style=for-the-badge&logo=bun)](package.json)

**The Mega AI Coding Harness** — Built on OpenClaw, supercharged with MiniMax M2.7, Agent Teams, AI Council, and full MiniMax CLI integration.

[Features](#features) · [Quick Start](#getting-started) · [DuckHive mmx](#duckhive-mmx) · [Agent Teams](#agent-teams) · [Architecture](#architecture) · [Comparison](#what-duckhive-adds-over-openclaude)

---

## Overview

DuckHive is an AI coding CLI agent harness built on [OpenClaw](https://github.com/openclaw/openclaw) by [GitLawB](https://github.com/Gitlawb). Think of it as OpenClaude supercharged: same harness architecture, but defaulting to **MiniMax M2.7**, integrating **Agent Teams** for multi-agent orchestration, **AI Council** for adversarial deliberation, and full **MiniMax CLI (mmx)** for image, speech, music, and video generation — all accessible from a single `duckhive` command.

### Key Differentiators from OpenClaude

| OpenClaude ships | DuckHive adds |
|-----------------|---------------|
| Claude as default | **MiniMax M2.7** as default |
| Basic tool set | **24 custom tools** including mmx, council, senate |
| Single-agent | **Agent Teams** — spawn multi-agent crews |
| No deliberation layer | **AI Council** — 46 adversarial councilors |
| No MiniMax modalities | **Full mmx** — image, speech, music, video |
| No shell toggle | **Ctrl-X shell toggle** |
| No hierarchical context | **DUCK.md** context loading (gemini-cli style) |
| Basic MCP | **dmcp** — enhanced MCP server management |

---

## Features

### Getting Started

```bash
git clone https://github.com/Franzferdinan51/DuckHive.git
cd DuckHive && bun install && bun run build
./bin/duckhive
```

Or after adding to PATH:

```bash
duckhive
```

---

### MiniMax M2.7 — Default Model

DuckHive boots with **MiniMax M2.7** as the default model, shown right in the startup banner. MiniMax M2.7 is a powerful reasoning and coding model that handles complex agentic tasks efficiently. The Hybrid Orchestrator routes tasks intelligently:

- **Complexity 1–3**: Fast path, direct execution
- **Complexity 4–6**: Best model routing + optional council
- **Complexity 7–10**: Full deliberation with AI Council

---

### DuckHive mmx — All MiniMax Modalities

DuckHive mmx gives you the full MiniMax CLI stack directly from the harness. Generate images, synthesize speech, create music, and produce video without leaving the CLI.

```bash
# Generate images
duckhive mmx image "A cyberpunk cat"
duckhive mmx image "A serene mountain lake at dawn" --aspect 16:9

# Text-to-speech
duckhive mmx speech synthesize --text "Hello from DuckHive" --out hello.mp3
duckhive mmx speech synthesize --text "System online" --voice narrator --out alert.mp3

# Music generation
duckhive mmx music generate --prompt "Upbeat electronic, driving beat" --out track.mp3
duckhive mmx music generate --prompt "Sad piano ballad" --lyrics "Verse 1: Lost in the rain..." --out ballad.mp3

# Video generation
duckhive mmx video "A drone flying through redwood trees"
```

---

### Ctrl-X Shell Toggle

Drop from AI mode into a real shell and return seamlessly — no second terminal needed.

```bash
# Inside duckhive
duckhive> Ctrl-X   # → drops to shell
$ ls -la
$ exit            # → returns to duckhive AI mode
```

Inspired by Kimi CLI's shell mode, built into the harness for zero-friction context switching.

---

### DUCK.md Context Loading

DuckHive loads hierarchical context from `DUCK.md` files (gemini-cli style), merging project context into every session. Place a `DUCK.md` in your project root:

```markdown
# My Project Context

## Project
- Name: MyApp
- Stack: Bun + TypeScript + Hono

## Key Files
- src/index.ts — entry point
- src/routes/ — API routes

## Commands
- bun run dev — start dev server
- bun run test — run tests
```

DuckHive automatically finds and loads the nearest `DUCK.md` up the directory tree, prepending it to every prompt.

---

### Agent Teams

Spawn multi-agent crews that work in parallel on complex tasks. DuckHive integrates Agent Teams for structured delegation.

```bash
# Inside duckhive
/council "Should we use microservices here?"       # 46 councilors debate
/team researcher "Research Redis caching"          # Spawn researcher agent
/senate "Proposal: switch to Bun runtime"         # 94 senators vote
/decree "DECREE-007: Use Bun for all new APIs"    # Issue binding law
/orchestrate "Build a REST API"                  # Route by complexity
```

**Governance pipeline**: Council debates → Senate passes decree → Teams execute per decree.

---

### MCP Server Management

Manage Model Context Protocol servers with the `dmcp` CLI.

```bash
duckhive dmcp list          # List installed MCP servers
duckhive dmcp add <server>  # Add an MCP server
duckhive dmcp remove <name> # Remove an MCP server
duckhive dmcp health        # Check MCP server health
```

---

### Custom Tools

DuckHive adds 24 custom tools on top of OpenClaw's base toolset:

| Tool | Command | Description |
|------|---------|-------------|
| **HiveCouncilTool** | `/council` | 46 AI councilors debate decisions |
| **HiveSenateTool** | `/senate` | 94 senators pass binding decrees |
| **HiveTeamTool** | `/team` | Spawn specialized multi-agent crews |
| **DecreeTool** | `/decree` | Issue and enforce binding laws |
| **OrchestrateTool** | `/orchestrate` | Smart complexity-based routing (1–10) |
| **MultiModelRouterTool** | `/router` | Route across 9+ providers |
| **ShadowGitTool** | `/shadow` | Git snapshots before changes (Gemini CLI style) |
| **CheckpointTool** | `/checkpoint` | Save and restore long AI sessions |
| **ContextTool** | `/context` | Hierarchical DUCK.md loading |
| **AndroidTool** | `/android` | Full Android control via ADB |
| **VisionTool** | `/vision` | Phone screenshot + AI analysis |
| **MemoryTool** | `/memory` | Long-term remember/recall |
| **KAIROSTool** | `/kairos` | Proactive heartbeat daemon |
| **MeshTool** | `/mesh` | Agent mesh networking |
| **SkillTool** | `/skill` | Runtime skill creation |
| **TrustedFoldersTool** | `/trusted-folders` | Folder-level security boundaries |
| **ShellModeTool** | `/shell-mode` | Ctrl-X AI↔shell toggle |
| **SwapTool** | `/swap` | AI/shell mode switching |
| **MCPManageTool** | `/mcp` | MCP server management |
| **ConfirmTool** | `/confirm` | Gum-style interactive prompts |
| **StatusBarTool** | `/statusbar` | Bubble Tea status bar rendering |
| **StreamTool** | `/stream` | Spinners, progress bars, thinking indicators |
| **REPLPanelTool** | `/panel` | Bubble Tea table/panel rendering |
| **DeskDevTool** | `/deskdev` | Desktop development mode |

---

## Architecture

```
DuckHive v0.6.0
├── MiniMax M2.7 (default model)
├── DuckHive mmx (MiniMax CLI integration)
│   ├── Image generation
│   ├── Speech synthesis
│   ├── Music generation
│   └── Video generation
├── Agent Teams (multi-agent orchestration)
│   ├── /council   — 46 adversarial councilors
│   ├── /senate    — 94 senators, binding decrees
│   └── /team      — spawn by role (researcher, coder, reviewer...)
├── AI Council (46 councilors)
├── MCP support (dmcp CLI)
├── Ctrl-X shell toggle
├── DUCK.md hierarchical context
├── Hybrid Orchestrator
│   ├── Task Complexity Classifier (1–10)
│   ├── Model Router (MiniMax M2.7, Kimi K2.5, Gemma 4, more)
│   └── Fallback Chain (retry → fallback → never fail)
└── 24 Custom Tools
```

---

## What DuckHive Adds Over OpenClaude

| Feature | OpenClaude | DuckHive |
|---------|-----------|---------|
| **Default Model** | Claude | MiniMax M2.7 ✅ |
| **MiniMax mmx** | ❌ | ✅ Image / Speech / Music / Video |
| **Agent Teams** | ❌ | ✅ Spawn multi-agent crews |
| **AI Council** | ❌ | ✅ 46 adversarial councilors |
| **Ctrl-X Shell Toggle** | ❌ | ✅ Seamless AI↔shell |
| **DUCK.md Context** | ❌ | ✅ Hierarchical gemini-cli style |
| **MCP CLI** | Basic | dmcp (enhanced) |
| **Governance** | ❌ | ✅ Council → Senate → Decree pipeline |
| **Shadow Git** | ❌ | ✅ Pre-change git snapshots |
| **Checkpoints** | ❌ | ✅ Session save/restore |
| **Bubble Tea TUI** | ❌ | ✅ Rich terminal rendering |
| **Multi-Model Router** | ❌ | ✅ 9+ provider routing |
| **Android Control** | ❌ | ✅ Full ADB integration |
| **KAIROS Daemon** | ❌ | ✅ Proactive heartbeat |

---

## Installation

### Prerequisites

- **Bun** 1.1+ (for build)
- **Node.js** 20+ (runtime)
- **Git**

### Build from Source

```bash
git clone https://github.com/Franzferdinan51/DuckHive.git
cd DuckHive
bun install
bun run build
```

### Run

```bash
./bin/duckhive
```

For convenience, add `bin/` to your PATH or symlink:

```bash
ln -s "$(pwd)/bin/duckhive" ~/.local/bin/duckhive
```

---

## Configuration

DuckHive inherits OpenClaw's configuration. Set up your environment:

```bash
# MiniMax API key (required for default model + mmx)
export MINIMAX_API_KEY=sk-your-key-here

# Optional: other providers
export KIMI_API_KEY=sk-kimi-...
export OPENAI_API_KEY=sk-...
export OPENROUTER_API_KEY=sk-or-...
export LMSTUDIO_URL=http://localhost:1234

# Optional: configure default model
export DUCK_CHAT_MODEL=MiniMax-M2.7
```

See `~/.openclaw/` for full configuration options.

---

## Usage

```bash
# Start interactive session
./bin/duckhive

# Single command
./bin/duckhive -- "Explain this codebase"

# With specific provider
./bin/duckhive -- --provider minimax --model MiniMax-M2.7

# Version
./bin/duckhive --version
```

---

## DuckHive mmx Quick Reference

```bash
duckhive mmx image "prompt" [--aspect 1:1|16:9|9:16]  # Generate image
duckhive mmx speech synthesize --text "..." --out file.mp3  # TTS
duckhive mmx music generate --prompt "..." --out track.mp3  # Music
duckhive mmx video "prompt"  # Video generation
```

---

## License

MIT License — see [LICENSE](LICENSE) file.

---

*Built on [OpenClaw](https://github.com/openclaw/openclaw) by [GitLawB](https://github.com/Gitlawb) · Powered by [MiniMax](https://www.minimax.io/) · DuckHive DNA*
