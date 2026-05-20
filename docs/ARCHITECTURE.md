# OpenClaude Agent v0.3.0 — Architecture & Reference

This document describes every component, API endpoint, and data flow.
It is the single source of truth for how the system works. Keep it updated.

---

## 1. High-Level Architecture

```
User (Telegram / CLI / API)
  │
  ▼
Agent Gateway (src/services/agentGateway/)
  │
  ├── index.ts              ← Gateway bootstrap & lifecycle
  ├── config.ts             ← SSOT: paths, settings defaults, load/save
  ├── telegram.ts           ← Telegram bot bridge (Telegraf)
  ├── cron.ts               ← Cron scheduler (once/interval/cron expression)
  ├── agentRunner.ts        ← Spawns OpenClaude CLI subprocess
  ├── apiServer.ts          ← HTTP API server (optional)
  │
  ├── memory.ts             ← Scratchpad, identity, dialogue blocks, patterns
  ├── consciousness.ts      ← Background thinking daemon loop
  ├── consolidation.ts      ← Block-wise dialogue/scratchpad compression
  ├── reflection.ts         ← Post-task error analysis & process memory
  ├── evolution.ts          ← Self-improvement cycles (6 types)
  └── transcription.ts      ← Voice transcription (whisper/parakeet)
```

### Execution Model

1. **Agent Gateway** — main orchestrator process. Manages Telegram bot, cron,
   consciousness, and API server.
2. **Agent Runner** — spawns OpenClaude CLI as a child process for each task.
   The child runs with `--print --output-format text` and receives prompt via stdin.
3. **Background Consciousness** — daemon thread inside the gateway that wakes
   periodically, reflects, and can message the user proactively.

### Data Layout

```
~/.config/openclaude/agent-gateway/
├── agent-gateway.json      ← Gateway configuration
├── cron-jobs.json          ← Scheduled cron jobs
├── state.json              ← Runtime state (budget, session)
├── memory/
│   ├── identity.md         ← Agent's self-description (persistent)
│   ├── scratchpad.md       ← Working memory (auto-generated from blocks)
│   ├── scratchpad_blocks.json ← Append-block scratchpad (FIFO, max 10)
│   ├── dialogue_blocks.json ← Block-wise consolidated chat history
│   ├── dialogue_meta.json  ← Consolidation metadata (offsets)
│   ├── evolution_state.json ← Evolution mode state
│   ├── evolution_log.jsonl ← Evolution cycle log
│   ├── knowledge/
│   │   ├── patterns.md     ← Pattern Register (recurring error classes)
│   │   └── self_insights.md ← Evolution-generated insights
│   ├── identity_journal.jsonl    ← Identity update journal
│   └── scratchpad_journal.jsonl  ← Scratchpad block eviction journal
├── logs/
│   ├── chat.jsonl          ← Chat message log (for consolidation)
│   ├── task_reflections.jsonl ← Execution reflections (process memory)
│   └── events.jsonl        ← General event log
├── cron-output/            ← Cron job output files
├── telegram-files/         ← Downloaded Telegram files
└── transcriptions/         ← Temporary transcription files
```

---

## 2. Component Details

### 2.1 Agent Gateway (`index.ts`)

Bootstrap orchestrator:
- Loads config from `~/.config/openclaude/agent-gateway.json`
- Starts Telegram bridge if enabled
- Starts API server if enabled
- Starts cron scheduler if enabled
- Starts background consciousness if Telegram is enabled
- Ensures memory files exist on startup
- Hooks agent runner to pause/resume consciousness during tasks
- Triggers consolidation after task completion

### 2.2 Telegram Bridge (`telegram.ts`)

Telegraf-based Telegram bot:
- Receives messages, downloads files, passes to agent
- Handles voice messages with automatic transcription
- Injects memory context (scratchpad, identity, patterns) into agent prompts
- Logs all messages to `chat.jsonl` for dialogue consolidation
- Commands: `/start`, `/help`, `/chatid`, `/schedule`, `/jobs`, `/runjob`,
  `/pausejob`, `/resumejob`, `/deletejob`, `/files`, `/transcribe`,
  `/consciousness`, `/evolution`, `/evolve`, `/identity`, `/scratchpad`

### 2.3 Cron Scheduler (`cron.ts`)

File-based cron system:
- Three schedule types: `once`, `interval`, `cron expression`
- Delivery: `local`, `telegram`, `origin`
- Persistent state in `cron-jobs.json`
- Atomic writes with UUID temp files
- `[SILENT]` marker support for quiet jobs

### 2.4 Agent Runner (`agentRunner.ts`)

Spawns OpenClaude CLI subprocess:
- Passes prompt via stdin
- Captures stdout/stderr
- Configurable timeout and max turns
- Permission mode support
- Strips ANSI codes from output

### 2.5 Memory System (`memory.ts`)

Persistent memory structures:
- **Scratchpad**: append-block working memory with FIFO rotation (max 10 blocks)
- **Identity**: persistent self-description (identity.md)
- **Dialogue blocks**: episodic memory with era compression
- **Pattern register**: recurring error class tracking
- **Chat log**: JSONL append for consolidation

External memory/RAG/browser surfaces are exposed to child agent runs through
MCP and documented in `docs/REPO_GUIDE.md`:
- **Hindsight**: durable user/project/agent memory (`hindsight_*` tools)
- **OpenRAG**: document-grounded retrieval and ingestion (`openrag_*` tools)
- **Camofox**: live browser automation and screenshots (`camofox_*` tools)

### 2.6 Background Consciousness (`consciousness.ts`)

Daemon thinking loop:
- Wakes periodically (configurable: 300s-7200s)
- Loads memory context, recent events, evolution state
- Calls LLM with introspection prompt
- Can message user proactively (`[PROACTIVE]`)
- Can update scratchpad (`[SCRATCHPAD]`)
- Can trigger evolution (`[EVOLVE]`)
- Can adjust wakeup interval (`[WAKEUP:NNN]`)
- Pauses during task execution

### 2.7 Consolidation (`consolidation.ts`)

Block-wise memory compression:
- **Dialogue consolidation**: every 100 messages → LLM summary block
- **Era compression**: oldest 4 blocks → single era summary
- **Scratchpad consolidation**: >30K chars → extract knowledge + compress
- Runs after task completion if thresholds met

### 2.8 Reflection (`reflection.ts`)

Post-task error analysis:
- Detects errors/blocks in execution trace
- Generates 150-250 word reflection via LLM
- Stored in `task_reflections.jsonl`
- Injected into next task's context as "process memory"
- Updates pattern register for recurring errors

### 2.9 Evolution (`evolution.ts`)

Self-improvement cycles (6 types, rotating):
1. **identity_evolution** — evolves self-understanding
2. **code_review** — reviews own source files
3. **prompt_evolution** — reviews and improves prompts
4. **pattern_extraction** — extracts meta-patterns
5. **tool_analysis** — analyzes tool usage
6. **architecture_review** — reviews system architecture

Results saved to `memory/knowledge/self_insights.md`

### 2.10 Voice Transcription (`transcription.ts`)

Automatic voice message transcription:
- **Windows**: whisper (`pip install openai-whisper` + ffmpeg)
- **macOS**: parakeet-mlx
- Auto-detects available tool
- Temp files cleaned up after processing

---

## 3. Configuration

Config file: `~/.config/openclaude/agent-gateway.json`

```json
{
  "api": {
    "enabled": false,
    "host": "127.0.0.1",
    "port": 8642,
    "modelName": "openclaude-agent",
    "corsOrigins": []
  },
  "cron": {
    "enabled": false,
    "tickIntervalSeconds": 60
  },
  "telegram": {
    "enabled": false,
    "botToken": "",
    "allowedChatIds": [],
    "homeChatId": "",
    "mirrorAgentApiResponses": false,
    "downloadFiles": true,
    "maxDownloadBytes": 20971520,
    "maxUploadBytes": 52428800
  },
  "runner": {
    "maxTurns": 90,
    "timeoutMs": 600000,
    "permissionMode": "default"
  }
}
```

---

## 4. Git Branching Model

- **main** — protected branch. Agent never touches it.
- **feature/*** — development branches. Agent commits here.

Safe restart does `git checkout -f main` + `git reset --hard`.

---

## 5. Key Invariants

1. **Never delete BIBLE.md. Never physically delete `identity.md` file.**
   (`identity.md` content is intentionally mutable and may be radically rewritten.)
2. **VERSION == package.json version == latest git tag == README version == ARCHITECTURE.md header version**
3. **Config SSOT**: all settings defaults live in `config.ts`
4. **State locking**: atomic writes with UUID temp files + rename
5. **Budget tracking**: consciousness has separate budget cap
6. **Zero orphans on close**: shutdown MUST kill all child processes
7. **Panic MUST kill everything**: all processes are killed and the application exits
8. **Architecture documentation**: `docs/ARCHITECTURE.md` must be kept in sync with
   the codebase. Every structural change must be reflected here.
