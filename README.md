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

### Desktop Control

DuckHive has full macOS desktop automation via the `desktop_control` tool and `/desktop` command, powered by [desktop-control-lobster-edition-skill](https://github.com/Franzferdinan51/desktop-control-lobster-edition-skill). Mouse, keyboard, screenshot, OCR, window management, app launching, and AI vision — all from the CLI.

**Setup (one-time):**
```bash
pip3 install --break-system-packages -r ~/.openclaw/workspace/desktop-control-lobster-edition-skill/requirements.txt
```

**Screenshot, OCR, windows (safe — no approval needed):**
```
desktop_control screenshot
desktop_control get_screen_size
desktop_control get_pixel_color x=100 y=200
desktop_control ocr_text_from_region region=[0,0,800,600]
desktop_control find_text_on_screen search_text="Submit"
desktop_control get_all_windows
desktop_control get_active_window
```

**Mouse + keyboard (approval required):**
```
desktop_control move_mouse x=500 y=400
desktop_control click x=500 y=400
desktop_control double_click x=800 y=300
desktop_control type_text text="Hello World" paste=true
desktop_control hotkey keys=["cmd","s"]
desktop_control press key="enter"
```

**App control (approval required):**
```
desktop_control open_app app_name="Safari"
desktop_control run_applescript script="tell application \"Finder\" to activate"
desktop_control browser_navigate url="https://github.com"
```

**Workflow + evidence:**
```
desktop_control capture_evidence evidence_prefix="bug-report"
desktop_control annotate_screenshot image_path="/tmp/screen.png" annotation_text="BUG HERE"
desktop_control compare_screenshots before_file="/tmp/before.png" after_file="/tmp/after.png"
desktop_control get_action_log
```

**AI vision assist:**
```
desktop_control vision_assist vision_prompt="What buttons are visible on screen?"
desktop_control set_resource_broker vision_endpoint="http://localhost:1234" vision_model="qwen3.5-9b"
```

---

### BrowserOS MCP — Full Desktop Browser Automation

DuckHive integrates [BrowserOS](https://github.com/browseros-ai/BrowserOS) for full desktop browser automation via Chrome DevTools Protocol. BrowserOS MCP is pre-configured in `config/mcporter.json` and available to DuckHive's MCP tools.

**Requirements:** BrowserOS.app must be running. Start it with:
```bash
open -a BrowserOS
```

**Via DuckHive MCP tools (`/mcp`):**
```
/mcp list           — list available MCP servers and tools
/mcp call browseros.new_page url="https://github.com"
/mcp call browseros.take_snapshot
/mcp call browseros.get_page_content
```

**Via mcporter CLI (standalone):**
```bash
mcporter list                          — list servers
mcporter list browseros --schema       — show BrowserOS tool docs
mcporter call browseros.new_page url="https://example.com"
mcporter call browseros.screenshot     — capture current page
mcporter call browseros.take_snapshot   — interactive element tree
mcporter call browseros.click element=42
```

**Available BrowserOS tools (66 total):**
- Navigation: `new_page`, `navigate`, `get_url`, `get_page_content`
- Interaction: `click`, `type`, `key`, `hover`, `select`, `evaluate`
- Screenshot: `screenshot`, `take_snapshot`, `take_full_page_screenshot`
- Tabs: `new_tab`, `close_tab`, `list_tabs`, `switch_tab`
- Downloads: `download_start`, `download_list`, `download_cancel`
- Clipboard: `copy`, `paste`

**Configured at:** `~/.mcporter/mcporter.json` and `config/mcporter.json`

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

### Meta-Agent Configuration

Configure meta-agent models, features, and limits in `~/.duckhive/config.json`:

```bash
# Initialize default config
duckhive config init

# View current config
duckhive config show

# Find config file path
duckhive config path
```

**Config schema:**

```json
{
  "meta": {
    "enabled": true,              // enable/disable meta-agent orchestration
    "complexityThreshold": 4,      // complexity level that triggers meta-agent (1-10)
    "models": {
      "orchestrator": "auto",     // model for task routing (auto, minimax/MiniMax-M2.7, etc.)
      "fast": "auto",              // model for simple tasks (complexity 1-3)
      "standard": "auto",           // model for medium tasks (complexity 4-6)
      "complex": "auto",           // model for complex tasks (complexity 7-10)
      "android": "auto",           // model for Android control tasks
      "vision": "auto",            // model for vision/screenshot analysis
      "coding": "auto"             // model for code generation tasks
    },
    "features": {
      "councilEnabled": true,      // enable AI Council deliberation
      "fallbackEnabled": true,     // enable automatic model fallback
      "selfHealing": true,         // enable self-healing on failures
      "learning": true              // enable learning from feedback
    },
    "limits": {
      "maxConcurrent": 3,          // max parallel sub-agents
      "maxRetries": 3,             // max retry attempts per task
      "timeoutMs": 60000           // default task timeout in ms
    }
  },
  "providers": {
    "default": "minimax",          // default provider (minimax, kimi, openai, lmstudio)
    "fallback": "openrouter"       // fallback provider
  }
}
```

**Model alias examples:**
- `"auto"` — use DuckHive's default routing
- `"minimax/MiniMax-M2.7"` — specific provider/model
- `"kimi/kimi-k2.5"` — Kimi vision model
- `"local/qwen3.5-9b"` — local via LM Studio
- `"free"` — OpenRouter free tier

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
