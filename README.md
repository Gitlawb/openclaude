<div align="center">

![DuckHive](https://img.shields.io/badge/DuckHive-v0.5.2-gold?style=for-the-badge&logo=buymeacoffee)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue?style=for-the-badge&logo=typescript)](package.json)
[![Bun](https://img.shields.io/badge/Bun-1.1-yellow?style=for-the-badge&logo=bun)](package.json)

**🦆 DuckHive — The Mega AI Coding Harness**  
*One harness. All systems. Infinite capability.*

Integrated: duck-cli · Agent Teams · AI Council · Charm.sh · Kimi CLI · Gemini CLI · Codex · Crush

</div>

---

## 🔥 What is DuckHive?

DuckHive is a unified AI coding harness that merges the best features from 8 different AI/CLI systems into a single, powerful program built on OpenClaw.

Instead of choosing between duck-cli's Hybrid Orchestrator, Agent Teams' council/senate governance, Kimi CLI's ACP protocol, and Gemini CLI's checkpoint system — **you get them all**.

```bash
# Install
git clone https://github.com/Franzferdinan51/openclaude.git
cd openclaude-integration && bun install && bun run build

# Run
./bin/duckhive
# or
node dist/cli.mjs
```

---

## ✅ What's Integrated (18 Custom Tools)

### 🏛️ Governance Layer (Hive Nation)
| Tool | Command | Description |
|------|---------|-------------|
| **HiveCouncilTool** | `/council` | 46 AI councilors debate decisions with adversarial deliberation |
| **HiveSenateTool** | `/senate` | 94 senators pass binding decrees (THE LAW) |
| **HiveTeamTool** | `/team` | Spawn specialized agents (researcher, coder, reviewer, writer) |
| **DecreeTool** | `/decree` | Issue, enforce, and revoke binding decrees |

### ⚡ Orchestration Layer
| Tool | Command | Description |
|------|---------|-------------|
| **OrchestrateTool** | `/orchestrate` | Smart task routing — complexity scoring, model selection, council triggers |
| **Hybrid Orchestrator** | *(internal)* | Task complexity analysis (1-10), smart model routing, fallback management |

### 📱 Device Control
| Tool | Command | Description |
|------|---------|-------------|
| **AndroidTool** | `/android` | Full Android control via ADB — tap, swipe, shell, screenshot |

### 🛡️ Security & Control
| Tool | Command | Description |
|------|---------|-------------|
| **CheckpointTool** | `/checkpoint` | gemini-cli style session save/restore |
| **TrustedFoldersTool** | `/trusted-folders` | gemini-cli style folder restriction |
| **DecreeTool** | `/decree` | Binding law enforcement |

### 🔧 System & DevOps
| Tool | Command | Description |
|------|---------|-------------|
| **ShellModeTool** | `/shell-mode` | kimi-cli style Ctrl-X shell mode switch |
| **SwapTool** | `/swap` | Switch between AI and shell mode |
| **MCPManageTool** | `/mcp` | MCP server management (list, start, stop, add tools) |
| **DeskDevTool** | `/deskdev` | Desktop development mode |

### 🧠 Memory & Proactivity
| Tool | Command | Description |
|------|---------|-------------|
| **MemoryTool** | `/memory` | Long-term memory — remember/recall/search across sessions |
| **KAIROSTool** | `/kairos` | Proactive heartbeat — tracks patterns, generates whispers |
| **MeshTool** | `/mesh` | Agent mesh networking — broadcast, peers, send messages |

### 👁️ Vision & Media
| Tool | Command | Description |
|------|---------|-------------|
| **VisionTool** | `/vision` | Phone screenshot capture + AI image analysis |
| **ConfirmTool** | `/confirm` | Gum-style interactive prompts (confirm/choose/input/filter) |

### 🎯 Skills
| Tool | Command | Description |
|------|---------|-------------|
| **SkillTool** | `/skill` | Runtime skill creation and improvement |

---

## 📐 Architecture

```
DuckHive (OpenClaw v2026.4.x)
├── Hybrid Orchestrator (duck-cli pattern)
│   ├── TaskComplexityClassifier (1-10 scoring)
│   ├── ModelRouter (Gemma 4 Android, Kimi K2.5 vision, MiniMax M2.7 reasoning)
│   └── CouncilBridge (triggers council for complexity ≥ 7)
├── Hive Nation Governance
│   ├── AI Council (46 councilors, adversarial deliberation)
│   ├── Senate (94 senators, binding decrees)
│   └── Team System (specialized agents)
├── ACP Bridge (kimi-cli style inter-agent protocol)
├── Checkpoint Manager (gemini-cli style session persistence)
├── Memory System (long-term SQLite-backed memory)
└── 18 Custom Tools
```

---

## 🔄 Phase Status

### ✅ Phase 1: Core Integration (DONE)
- Hive Bridge service (TypeScript API client)
- `/council` — AI Council deliberation
- `/senate` — Senate decree system
- `/team` — Team spawning
- `/decree` — Binding decree enforcement

### ✅ Phase 2: Enhanced Features (DONE)
- `/shell-mode` — kimi-cli style Ctrl-X
- `/checkpoint` — gemini-cli style session save/restore
- `/trusted-folders` — folder restriction security
- `/mcp-manage` — MCP server management

### ✅ Phase 3: Deep Integration (DONE)
- Council deliberation embedded in task pipeline
- Decree enforcement in tool execution
- Hybrid Orchestrator (complexity scoring + model routing)
- Team coordination via ACP

### 🔄 Phase 4: TUI Components (PARTIAL)
- Gum-style confirmation dialogs (`/confirm`) ✅
- Lip Gloss color output for REPL ⚙️
- Bubble Tea-style rendering ⚙️

### 🔄 Phase 5: ACP Protocol (PARTIAL)
- ACP Bridge (kimi-cli style agent communication) ✅
- MCP server management ✅
- Shell mode integration ✅

---

## 🌍 Deep Integration Sources

| Source | What we integrated |
|--------|-------------------|
| **duck-cli** | Hybrid Orchestrator, KAIROS daemon, Memory system, Skill creator |
| **Agent Teams** | Council/Senate/Team governance, decree system, swarm coding |
| **AI Council** | 46 councilors, 11 deliberation modes, adversarial debate |
| **Charm.sh** | Bubble Tea patterns (TUI), Gum prompts (ConfirmTool) |
| **Kimi CLI** | ACP protocol, shell mode (Ctrl-X swap), inter-agent messaging |
| **Gemini CLI** | Checkpoint manager, trusted folders |
| **Codex** | IDE integration patterns (via OpenClaw) |
| **Crush** | Multi-model routing concepts |

---

## 🚀 Running DuckHive

```bash
# From repo
cd ~/.openclaw/workspace/openclaude-integration
bun run build
./bin/duckhive

# Or globally
duckhive
openclaude

# With specific model
./bin/duckhive --model minimax-portal/MiniMax-M2.7

# Check status
./bin/duckhive tools list | grep -i hive
```

---

## 📊 Metrics

- **18 custom DuckHive tools** added to OpenClaw
- **4 orchestration services**: Hybrid, ACP, Checkpoint, Hive Bridge
- **3 governance systems**: Council, Senate, Team
- **Build**: ✅ Clean (`bun run build` → `dist/cli.mjs`)
- **Type-check**: ✅ Clean (`npx tsc --noEmit --skipLibCheck`)
- **Git**: 8 commits pushed, clean workspace

---

## 🦆 Philosophy

> "One harness to rule them all — not 8 different programs that each do one thing."

DuckHive is built on the principle of **deep integration over shallow wrappers**. We're not bundling 8 programs — we're taking the best ideas from each and making them work together as one unified system.

---

*Built on [OpenClaw](https://github.com/openclaw/openclaw) · Powered by MiniMax M2.7 · Managed by Duck CLI memory*
