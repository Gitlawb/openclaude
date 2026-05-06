# OpenClaude Desktop App Design

**Date**: 2026-05-03
**Status**: Draft
**Scope**: Full GUI desktop app with CLI parity, built on OpenClaude SDK

## 1. Overview

Build a professional Electron desktop application inside the OpenClaude monorepo (`packages/desktop/`) that provides full CLI parity — all OpenClaude features accessible through a modern GUI. The app is built on top of the OpenClaude SDK and follows a wave-based PR strategy for incremental delivery.

### Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Runtime** | Electron 39 | **Stability & compatibility:** Mature ecosystem, battle-tested by VS Code, Slack, Discord. **Node.js native:** SDK runs directly in main process — no sidecar process needed for MCP servers, tool execution, file operations. **Tauri trade-offs:** Smaller binary (~10-50MB vs ~150MB) but requires sidecar for any Node.js work, plus Rust learning curve for team contributions. Open to discussion in PR thread if strong preference for Tauri emerges. |
| **Repo structure** | Same repo, `packages/desktop/` | **Direct SDK access:** Import from `@gitlawb/openclaude` workspace without publishing to npm first. **Shared CI:** Reuse existing test infrastructure, smoke tests, type checking. **Unified development:** One clone for CLI + desktop; contributors can work on both without separate repos. **Trade-off:** Larger repo, but manageable with workspaces and clear `packages/` boundaries. |
| Scope | Full GUI (CLI parity) | All CLI features in GUI form |
| Architecture | Feature-based monolith | Proven pattern, clean PR boundaries |
| IPC | tRPC | Type-safe, compile-time checks |
| State management | Jotai + Zustand | Jotai for atoms, Zustand for complex state |
| Database | SQLite + Drizzle ORM | Lightweight, embedded, zero config |
| Terminal | External terminal | Simpler, avoid xterm.js complexity |
| UI framework | Tailwind + Radix/shadcn | Modern, performant, customizable |
| Code editor | Monaco Editor | VS Code engine, full language support |
| Build system | electron-vite + electron-builder | Fast dev builds, multi-platform packaging |

## 2. Electron Process Architecture

```
Renderer (React 19 + Tailwind + shadcn + Jotai/Zustand)
    │
    │ tRPC Client (type-safe)
    │
Preload (contextBridge + tRPC proxy)
    │
    │ IPC
    │
Main Process
    ├── tRPC Server (routers per feature)
    ├── SDK Host (OpenClaude SDK orchestration)
    ├── Database (SQLite + Drizzle)
    ├── Window Manager
    ├── File System Access
    └── Auto-updater + Protocol Handler
```

### Process Responsibilities

**Main Process**:
- Hosts the OpenClaude SDK — renderer never accesses SDK directly
- Runs tRPC server with feature-based routers
- Manages SQLite database via Drizzle ORM
- Handles file system operations, window management
- Manages auto-updater and protocol handlers

**Preload Script**:
- Minimal — only tRPC proxy via contextBridge
- Small attack surface
- No direct Node.js API exposure to renderer

**Renderer Process**:
- Pure React application
- No Node.js API access — all I/O through tRPC
- Feature-based organization (chat, tools, editor, settings, projects, mcp, skills, stats)
- Jotai for atomic/reactive state, Zustand for complex stores

## 3. Directory Structure

```
packages/desktop/
├── package.json
├── electron.vite.config.ts
├── tsconfig.json
├── tailwind.config.ts
├── drizzle.config.ts
│
├── src/
│   ├── main/
│   │   ├── index.ts                    # App entry, window management
│   │   ├── ipc/
│   │   │   ├── trpc.ts                 # tRPC init + context
│   │   │   ├── routers/
│   │   │   │   ├── chat.ts
│   │   │   │   ├── tools.ts
│   │   │   │   ├── settings.ts
│   │   │   │   ├── projects.ts
│   │   │   │   ├── mcp.ts
│   │   │   │   ├── skills.ts
│   │   │   │   └── stats.ts
│   │   │   └── index.ts                # Router aggregation
│   │   ├── db/
│   │   │   ├── schema/                 # Drizzle schema definitions
│   │   │   ├── migrations/
│   │   │   └── client.ts
│   │   ├── sdk/
│   │   │   ├── host.ts                 # SDK lifecycle management
│   │   │   ├── permissions.ts          # Permission mode enforcement + auto-approve logic
│   │   │   ├── pluginHost.ts           # Plugin lifecycle, isolation, health monitoring
│   │   │   └── events.ts               # SDK event → tRPC bridge
│   │   ├── services/
│   │   │   ├── updater.ts
│   │   │   └── protocol.ts
│   │   └── utils/
│   │
│   ├── preload/
│   │   └── index.ts                    # contextBridge + tRPC proxy
│   │
│   ├── renderer/
│   │   ├── index.html
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── features/
│   │   │   ├── chat/
│   │   │   │   ├── components/
│   │   │   │   │   ├── PermissionModeSelector.tsx  # Mode dropdown in chat input
│   │   │   │   │   ├── PermissionDialog.tsx        # Tool approval dialog
│   │   │   │   │   └── PermissionBadge.tsx         # Current mode indicator
│   │   │   │   ├── hooks/
│   │   │   │   └── store.ts
│   │   │   ├── tools/
│   │   │   │   ├── components/
│   │   │   │   └── store.ts
│   │   │   ├── editor/
│   │   │   │   ├── components/
│   │   │   │   └── hooks/
│   │   │   ├── settings/
│   │   │   │   ├── components/
│   │   │   │   └── store.ts
│   │   │   ├── projects/
│   │   │   │   ├── components/
│   │   │   │   └── store.ts
│   │   │   └── mcp/
│   │   │       ├── components/
│   │   │       └── store.ts
│   │   │   ├── diff/
│   │   │   │   ├── components/
│   │   │   │   │   ├── DiffViewer.tsx          # Unified + split diff views
│   │   │   │   │   ├── DiffHeader.tsx          # File path, +/- counts, view toggle
│   │   │   │   │   ├── DiffNavigation.tsx      # Next/prev change buttons
│   │   │   │   │   ├── InlineDiff.tsx          # Inline diff in chat messages
│   │   │   │   │   └── DiffMinimap.tsx         # Minimap overview for large diffs
│   │   │   │   ├── hooks/
│   │   │   │   │   └── useDiff.ts              # Diff computation + view mode
│   │   │   │   └── store.ts
│   │   │   ├── skills/
│   │   │   │   ├── components/
│   │   │   │   │   ├── SkillList.tsx         # Slash command list + search
│   │   │   │   │   ├── SkillCard.tsx         # Individual skill display
│   │   │   │   │   ├── SkillExecutor.tsx     # Skill execution + args form
│   │   │   │   │   ├── PluginDashboard.tsx   # Plugin list + status + health
│   │   │   │   │   ├── PluginCard.tsx        # Single plugin: status, skills, agents, tools
│   │   │   │   │   └── PluginError.tsx       # Error display with fix suggestions
│   │   │   │   ├── hooks/
│   │   │   │   │   └── useSkillExecution.ts  # Skill invocation logic
│   │   │   │   └── store.ts
│   │   │   └── stats/
│   │   │       ├── components/
│   │   │       │   ├── StatsOverview.tsx      # Summary cards + activity heatmap
│   │   │       │   ├── StatsModels.tsx        # Per-model usage charts
│   │   │       │   ├── ActivityHeatmap.tsx    # GitHub-style contribution grid
│   │   │       │   ├── TokenChart.tsx         # Token usage over time graph
│   │   │       │   ├── CostBreakdown.tsx      # Cost per model pie/bar chart
│   │   │       │   └── SessionTimeline.tsx    # Session activity timeline
│   │   │       ├── hooks/
│   │   │       │   └── useStats.ts            # Stats data fetching + date range
│   │   │       └── store.ts
│   │   ├── components/
│   │   │   ├── ui/                     # shadcn components
│   │   │   └── layout/                 # App shell, sidebar
│   │   ├── stores/
│   │   │   ├── theme.ts
│   │   │   └── app.ts
│   │   ├── lib/
│   │   │   ├── trpc.ts                 # tRPC client setup
│   │   │   └── utils.ts
│   │   └── styles/
│   │       └── globals.css
│   │
│   └── shared/
│       ├── types.ts
│       ├── trpc-routers.ts
│       └── constants.ts
│
├── resources/                          # App icons, binaries
├── scripts/
└── tests/
    ├── main/
    ├── preload/
    └── renderer/
```

## 4. Permission System

The desktop app implements a 4-mode permission system. Unlike the CLI (which defaults to bypass), the desktop app defaults to the safest mode.

### Permission Modes

| Mode | Behavior | Use Case |
|------|----------|----------|
| **Ask permissions** (default) | Prompts user for every tool call — file reads, writes, bash commands, etc. | Maximum safety, full control |
| **Accept edits** | Auto-approves file read/write operations, prompts for bash commands and other risky operations | Balanced — trust file edits, verify commands |
| **Plan mode** | AI plans first, shows plan, asks for approval before executing any action | Review before execution |
| **Bypass permissions** | Skips all permission checks — equivalent to `--dangerously-skip-permissions` | Power users, trusted environments |

### Permission Flow

```
SDK requests tool execution
         │
    ┌────┴────┐
    │ SDK Host │ ← checks current permission mode
    └────┬────┘
         │
   ┌─────┴─────────────────────────────┐
   │                                   │
[Ask / Accept edits]              [Plan mode]         [Bypass]
   │                                   │                   │
   ├── Auto-allowed?                   │                   │
   │   (Accept edits: file ops)        │                   ├── Execute
   │   │                               │                   │   immediately
   │   ├── Yes → Execute               │                   │
   │   └── No → Show dialog            │                   │
   │            │                      │                   │
   │     ┌──────┴──────┐          Show plan                 │
   │     │             │               │                    │
   │  [Approve]    [Reject]      [Approve plan]             │
   │     │             │               │                    │
   │  Execute     Cancel        Execute plan                │
   │                              step by step              │
   └──────────────────────────────┴─────────────────────────┘
```

### Permission Mode Selector

- Displayed in the chat input area as a dropdown/toggle
- Persisted per-session in database (default from global settings)
- Can be changed mid-conversation
- Bypass mode requires explicit confirmation dialog ("Are you sure?")
- Visual indicator shows current mode at all times (color-coded badge)

### Permission Categories (for Accept Edits mode)

| Category | Ask | Accept Edits | Plan | Bypass |
|----------|-----|-------------|------|--------|
| File read | prompt | auto | plan | auto |
| File write/create | prompt | auto | plan | auto |
| File delete | prompt | prompt | plan | auto |
| Bash command | prompt | prompt | plan | auto |
| Web search | prompt | auto | plan | auto |
| MCP tool call | prompt | prompt | plan | auto |

## 5. SDK Integration Layer

The main process wraps the OpenClaude SDK in a **SDK Host** layer that bridges SDK events to tRPC subscriptions. The SDK host enforces the permission system before executing any tool.

```
Renderer                          Main Process
────────                          ────────────
useChat() hook                    SDK Host Layer
  → trpc.chat.sendMessage()        ├── createSession(provider, model, permissionMode)
  ← subscription: onStream         ├── sendMessage(sessionId, content)
  ← subscription: onToolCall       ├── on('stream', chunk → tRPC.emit)
  ← subscription: onPermissionReq  ├── on('toolCall', → permission check)
  → trpc.tools.approve()           │   ├── auto-approve? → execute
  → trpc.tools.reject()            │   └── needs approval? → emit onPermissionReq
                                   └── approveTool/rejectTool
                                  Database Layer
                                   ├── saveMessage()
                                   ├── saveToolResult()
                                   └── trackTokenUsage()
```

### tRPC Router Structure

**chatRouter**:
- `sendMessage` — mutation, sends user message via SDK
- `onStream` — subscription, streams AI response chunks
- `onToolCall` — subscription, notifies tool execution requests
- `onPermissionRequest` — subscription, prompts user for tool approval (Ask/Accept Edits modes)
- `approveTool` / `rejectTool` — mutations, tool approval flow
- `setPermissionMode` — mutation, changes active permission mode for session
- `getHistory` — query, fetches chat history from DB
- `listSessions` — query, lists conversation sessions

**toolsRouter**:
- `getToolResult` — query, fetches tool execution result
- `listTools` — query, lists available tools for current session

**settingsRouter**:
- `getProviders` — query, lists configured providers
- `setApiKey` — mutation, saves API key (keytar/encrypted)
- `getModelProfiles` — query, lists custom model profiles
- `getPreferences` / `setPreferences` — preferences CRUD

**projectsRouter**:
- `listProjects` — query, lists all persisted projects sorted by lastOpenedAt
- `openFolder` — mutation, opens native folder picker, validates path, saves to DB
- `openProject` — mutation, switches active project by id
- `getProject` — query, returns single project with git metadata
- `validateProject` — query, checks project path exists and is accessible
- `getGitStatus` — query, returns git status for project (branch, staged, unstaged)

**mcpRouter**:
- `listServers` — query, lists configured MCP servers
- `addServer` / `removeServer` — mutations
- `getServerTools` — query, lists tools from specific MCP server
- `getServerStatus` — query, health check

**skillsRouter**:
- `listSkills` — query, discovers and returns all available skills (file-based, plugin, bundled, MCP)
- `getSkillDetail` — query, returns skill metadata (description, args, frontmatter, source plugin)
- `executeSkill` — mutation, invokes a skill by name with arguments (passes through to SDK host)
- `onSkillOutput` — subscription, streams skill execution output
- `listPlugins` — query, lists installed plugins with status (loaded/error/loading/disabled), manifest data
- `getPluginDetail` — query, returns plugin's contributed skills, agents, tools, health status
- `installPlugin` / `uninstallPlugin` — mutations, plugin lifecycle with validation and rollback on failure
- `enablePlugin` / `disablePlugin` — mutations, toggle without uninstalling
- `onPluginStatusChange` — subscription, real-time plugin status updates (loading→loaded, loaded→error, etc.)
- `getPluginErrors` — query, returns recent plugin errors with stack traces and fix suggestions

**statsRouter**:
- `getOverview` — query, returns session counts, token totals, active days, streaks, peak hours
- `getModels` — query, returns per-model usage breakdown (tokens, cost, request count)
- `getDailyActivity` — query, returns daily activity data for heatmap visualization
- `getTokenTrend` — query, returns time-series token usage for charts (7d/30d/all-time)
- `getCostBreakdown` — query, returns cost distribution by model/provider
- `getSessionStats` — query, returns current session real-time stats (tokens used, cost, duration)

## 6. Database Schema (SQLite + Drizzle)

### Tables

**projects**:
- id, name, path, gitBranch, gitRemoteUrl, gitProvider, gitOwner, gitRepo, lastOpenedAt, createdAt

**sessions**:
- id, projectId, title, provider, model, permissionMode (ask|accept_edits|plan|bypass), createdAt, updatedAt, **archivedAt** (soft delete — null = active)

**messages_jsonl** (Hybrid Storage — SDK-compatible):
- id (INTEGER PK), sessionId, lineNumber, **content** (TEXT — raw SDK JSONL line, untouched), uuid, parentUuid, role (user|assistant|tool|system), createdAt, toolName (extracted metadata for indexing)
- **Why hybrid:** SDK uses JSONL + parentUuid tree structure. Relational tables break fork support + require conversion overhead. Hybrid preserves SDK format (content column = raw JSONL) + adds metadata columns for indexed queries.
- **Indexes:** sessionId, role, toolName, createdAt, uuid
- **SDK compatibility:** Load = read content → return JSONL array directly. Save = append JSONL + extract metadata. Zero conversion overhead.

**settings**:
- key, value (JSON), updatedAt

**mcpServers**:
- id, name, command, args (JSON), env (JSON), status (enum: stopped|running|error|starting), createdAt

**providerKeys**:
- id, provider (UNIQUE), encryptedKey, createdAt (encrypted via OS keychain in PR4+)

**plugins**:
- id, name, version, source (enum: marketplace|local|git), path, enabled, status (enum: loaded|error|loading|disabled), manifest (JSON), installedAt, updatedAt, lastError

**NOTE:** Original design had separate `messages` + `toolCalls` tables (flat relational). Replaced with `messages_jsonl` hybrid approach after SDK compatibility analysis (2026-05-06). SDK's JSONL format + parentUuid tree structure cannot be flattened without breaking forkSession + adding conversion overhead.

## 7. Wave-Based PR Plan

### Wave 1: Foundation (4 PRs, parallel)

**PR1: Electron Shell + Build System** (~1500 lines)
- Files: `package.json`, `electron.vite.config.ts`, `src/main/index.ts`, `src/preload/index.ts`, `scripts/`, `resources/`
- Content: electron-vite setup, main process entry (window creation, app lifecycle), preload script skeleton, build scripts
- Tests: Main process lifecycle tests, window creation tests

**PR2: tRPC Infrastructure** (~1200 lines)
- Files: `src/main/ipc/trpc.ts`, `src/main/ipc/index.ts`, `src/shared/`, `src/preload/` (tRPC bridge), `src/renderer/lib/trpc.ts`
- Content: tRPC server setup, context, base router, preload tRPC proxy, renderer tRPC client, shared type definitions
- Tests: tRPC router unit tests, IPC integration tests

**PR3: Database Layer** (~1500 lines)
- Files: `src/main/db/`, `drizzle.config.ts`, `scripts/db/`
- Content: Drizzle schema (all tables), SQLite client, migration system, seed data, query helpers
- Tests: Schema tests, migration tests, CRUD operation tests

**PR4: Frontend Draft / UI Reference** (~2000 lines)
- Files: `src/renderer/` (skeleton), `tailwind.config.ts`, `src/renderer/components/ui/`, `src/renderer/styles/`
- Content: Vite renderer config, Tailwind setup, 10-15 shadcn base components, App shell layout, theme system, routing skeleton
- Tests: Component rendering tests, theme toggle tests
- **Note**: PR4 branch (`desktop/pr4-react-ui-shell`) serves as a visual reference and will not be merged as-is. Final UI implementation will be built per-wave.

### Wave 2: Core Features — Phase A (2 PRs, parallel, requires Wave 1)

PR5 (Chat UI) requires an active provider connection and API key to function. Therefore SDK Host and Settings must land first.

**PR5: SDK Host Integration** (~2500 lines)
- Files: `src/main/sdk/`, `src/main/ipc/routers/chat.ts`, `src/main/ipc/routers/tools.ts`
- Content: SDK host (session lifecycle, provider management), event→tRPC bridge, streaming pipeline, tool approval flow, **permission mode enforcement** (`permissions.ts` — auto-approve logic per mode), error handling
- Tests: SDK host unit tests, session lifecycle tests, event bridge tests, **permission enforcement tests**

**PR6: Settings UI + Provider Setup** (~1800 lines)
- Files: `src/renderer/features/settings/`, `src/main/ipc/routers/settings.ts`
- Content: Provider configuration forms, API key management (encrypted storage), model selection, preferences, theme toggle, settings store
- Tests: Settings form tests, provider config tests

### Wave 2: Core Features — Phase B (2 PRs, parallel, requires Phase A)

**PR7: Chat UI + Streaming + Projects** (~4000 lines)
- Files: `src/renderer/features/chat/`, `src/renderer/features/projects/`, `src/main/ipc/routers/chat.ts`, `src/main/ipc/routers/projects.ts`
- Content: Message list component, input area with file attachment, streaming message display, markdown rendering, code block rendering, **PermissionModeSelector** (dropdown in chat input), **PermissionDialog** (tool approval modal), **PermissionBadge** (mode indicator), **ProjectSelector** (folder picker + recent projects), **NewChatForm** (project selection flow), chat store, project store
- Tests: Message rendering tests, streaming mock tests, input component tests, permission mode selector tests, approval dialog tests, project selection tests

#### PR5 Detail: Chat Input — Rich Text & Mentions

**Custom textarea** (not TipTap/Lexical — keep simple):
- Plain `<textarea>` with overlay for mention chips and slash command dropdown
- `@` prefix triggers file mention dropdown with fuzzy search over project files
- Selected files shown as inline chips/tags in the input area
- File content passed as context to AI via SDK host
- Drag & drop file support — dropped files appear as chips
- Multi-line: `Shift+Enter` for newline, `Enter` sends
- Autogrow: textarea height adjusts to content (max ~40vh)

#### PR5 Detail: Slash Command Autocomplete

- `/` prefix triggers dropdown of available skills/commands (from `skillsRouter.listSkills`)
- Dropdown shows: command name, short description, source plugin name
- Filtered by typing after `/` (fuzzy match on name + description)
- `Enter` or click to insert command; `Escape` to dismiss
- Arrow key navigation within dropdown
- Commands sourced from: file-based `.claude/skills/`, plugin-contributed, bundled, MCP tools

#### PR5 Detail: Streaming Rendering

- tRPC subscription (`onStream`) for real-time response chunks
- Progressive markdown rendering — render partial content as it arrives
- Token count live update in input area context circle (input tokens consumed)
- Abort button visible during streaming (calls `trpc.chat.abort()`)
- Streaming state tracked in chat store: `idle | streaming | paused | error`

#### PR5 Detail: Virtualized Message List

- Library: `@tanstack/react-virtual`
- Dynamic row height estimation based on content length
- Overscan: 5 messages above/below viewport for smooth scrolling
- Auto-scroll to bottom on new assistant message (unless user has scrolled up)
- "Scroll to bottom" floating button appears when not at bottom

#### PR5 Detail: Project Selection & Management

**New Chat Flow**:
1. User clicks "New Chat" (or app opens fresh)
2. `NewChatForm` renders — shows "Select folder" if no project selected
3. User picks project via `ProjectSelector` dropdown (recent list or open folder dialog)
4. Once project selected → chat input becomes active, model/provider selectors appear
5. User types message → SDK host creates session with project context → chat begins

**ProjectSelector component**:
- Button showing current project name (or "Select folder" placeholder)
- Dropdown popover with: search input, recent projects list, "Open folder…" button
- Search filters recent projects by name/path (fuzzy match)
- Each project row: project name, path (truncated), git provider icon if applicable
- Selected project highlighted with checkmark
- "Open folder…" opens native OS folder picker via `trpc.projects.openFolder` mutation

**Project persistence**:
- All opened projects saved to SQLite `projects` table (id, name, path, gitBranch, gitRemoteUrl, gitProvider, gitOwner, gitRepo, lastOpenedAt)
- Jotai atom `selectedProjectAtom` with localStorage persistence (survives app restart)
- Project validation on load: check project still exists on disk, remove stale entries
- `lastOpenedAt` updated on every chat start → recent projects sorted by recency
- Project metadata: git remote URL, git provider (GitHub/GitLab/Bitbucket), owner, repo name

**NewChatForm component**:
- Conditional render: no project → centered "Select folder" CTA
- Project selected → full chat input with project badge, model selector, permission mode
- Project badge clickable → reopens ProjectSelector to switch mid-session
- Auto-creates new session in DB on first message send

**tRPC endpoints** (projectsRouter — expanded for PR7):
- `listProjects` — query, returns all persisted projects sorted by lastOpenedAt
- `openFolder` — mutation, opens native folder picker, validates path, saves to DB, returns project
- `getProject` — query, returns single project by id with git status
- `validateProject` — query, checks project path exists and is accessible
- `getGitStatus` — query, returns git status for active project (branch, staged, unstaged)

#### PR7 Detail: Sidebar Architecture (Project-Centric Design)

Direct project → session structure with lazy-loaded active chats.

**Sidebar Layout** (top to bottom):
```
┌─────────────────────────┐
│ [+ New Chat] button     │ ← Top: always visible, opens project selector
├─────────────────────────┤
│ Project 1 (expanded)    │ ← Collapsible dropdown per project
│   ├─ [+ Quick Chat]     │ ← Hover: quick new chat for THIS project
│   ├─ Session A (active) │ ← Last 5 active sessions (not archived)
│   ├─ Session B          │
│   ├─ Session C          │
│   ├─ Session D          │
│   ├─ Session E          │
│   └─ [Load More]        │ ← Lazy load older sessions
├─────────────────────────┤
│ Project 2 (collapsed)   │ ← Chevron icon shows expand state
│   [▶]                   │
├─────────────────────────┤
│ Project 3               │
│   [▶]                   │
└─────────────────────────┘
│ [Search 🔍]             │ ← Search all sessions across projects
└─────────────────────────┘
```

**Components**:

**SidebarHeader**:
- Large `[+ New Chat]` button at top
- Click → opens `ProjectSelector` modal (must pick project before starting)
- Shortcut: `Cmd/Ctrl+N`

**ProjectDropdown** (collapsible per project):
- Header row: project name, chevron icon (expanded/collapsed), hover-revealed `[+]` button
- `[+]` button (appears on hover): Quick new chat for THIS project (bypasses project selector)
- Expanded state shows: last 5 active sessions (archived_at IS NULL)
- Each session row: title (truncated), timestamp, active indicator (blue dot)
- Footer (if >5 sessions): `[Load More]` button
- Collapse state: just project header with chevron
- Click header → toggle expand/collapse
- Active project (selectedProjectAtom) highlighted with accent border

**Load More Pattern** (lazy loading):
- Initial load: 5 most recent active sessions per project (DB query limit=5)
- Click `[Load More]` → fetch next 10 sessions for that project
- Progressive loading prevents DB overload
- Virtualized list for 100+ sessions (tanstack/react-virtual)

**Session Search**:
- Search icon button at sidebar footer
- Opens modal with search input
- Searches across ALL sessions (all projects)
- Results: session title, project name, timestamp
- Click result → switches to that session + project

**Archive/Unarchive** (soft delete):
- Right-click session → Archive option
- Archived sessions hidden from sidebar dropdown
- Archive endpoint: `trpc.sessions.archive(sessionId)`
- Unarchive endpoint: `trpc.sessions.unarchive(sessionId)`
- Archive button in session header (three-dot menu)
- Archived view: separate tab or filter toggle in search modal

**tRPC endpoints** (sessionsRouter — new for PR7):
- `listActiveSessions(projectId, limit=5)` — query, returns active sessions (archived_at IS NULL)
- `loadMoreSessions(projectId, offset, limit=10)` — query, pagination for older sessions
- `searchSessions(query)` — query, searches all session titles across projects
- `archiveSession(sessionId)` — mutation, sets archived_at timestamp
- `unarchiveSession(sessionId)` — mutation, sets archived_at = NULL
- `getSession(sessionId)` — query, returns session with messages count

**Database queries** (from queries.ts):
- `getRecentSessions(projectId, limit=5)` — Only active (archivedAt IS NULL)
- `archiveSession(sessionId)` — Soft delete
- `unarchiveSession(sessionId)` — Restore

**State management** (Jotai atoms):
- `projectsListAtom` — All projects sorted by lastOpenedAt
- `projectDropdownStateAtom` — Map of projectId → expanded/collapsed boolean
- `activeSessionsAtom(projectId)` — Per-project active session list (lazy loaded)
- `selectedSessionAtom` — Current active session id
- `selectedProjectAtom` — Current project id

**UX Flow Examples**:

1. **New chat via top button**:
   - Click `[+ New Chat]` → ProjectSelector modal
   - Pick project → NewChatForm opens
   - First message → session created, appears in sidebar under that project

2. **Quick new chat for specific project**:
   - Hover over Project 2 → `[+]` button appears
   - Click `[+]` → directly opens NewChatForm with Project 2 pre-selected
   - Bypasses project selector (already know target project)

3. **Resume existing session**:
   - Expand Project 1 dropdown
   - See last 5 active sessions
   - Click "Session B" → switches to that session
   - selectedSessionAtom updates, chat loads

4. **Archive session**:
   - Right-click "Session A" → Archive
   - Session A disappears from dropdown (moved to archived)
   - archived_at timestamp set in DB

5. **Search across projects**:
   - Click search icon → modal opens
   - Type "debug" → shows matching sessions from all projects
   - Click result → switches project + session

**PR8: Tool System UI** (~2000 lines)
- Files: `src/renderer/features/tools/`
- Content: Tool call display component, result rendering (text, diff, file), approval/reject buttons, tool status indicators, tool call store
- Tests: Tool rendering tests, approval flow tests

#### PR8 Detail: Tool-Specific Rendering

**Bash Tool**:
- Expandable card showing: command (in monospace), output, exit code badge
- ANSI color support for terminal output (parse ANSI escape codes → styled spans)
- Output collapsible for long outputs (>20 lines shows "Show more" toggle)
- Exit code: `0` → green badge, non-zero → red badge with error details
- Copy button for command + output

**File Edit Tool**:
- Inline diff preview (unified view) directly in chat message
- File path header with `+N/-M` line count badges (green/red)
- Syntax highlighting via Monaco grammar tokens (same as editor feature)
- "Accept" / "Reject" buttons per edit (when in Ask/Accept edits mode)
- Collapsed by default — click to expand full diff

**Web Search Tool**:
- Search query display at top of card
- Result cards: title (clickable), snippet text, source URL
- Expandable for full page content (fetched via SDK)
- Source domain favicon/icon next to each result

**Generic Tool Call**:
- Tool name + status indicator (spinner for running, checkmark for completed, X for failed)
- Expandable input JSON (syntax highlighted, collapsible)
- Expandable output JSON (same treatment)
- Duration display: `X.Xs` in muted text
- Error state: red border, error message, retry button

### Wave 3: Advanced Features (3 PRs, parallel, requires Wave 2)

**PR9: Monaco Editor Integration** (~2500 lines)
- Files: `src/renderer/features/editor/`
- Content: Monaco editor wrapper component, file viewer, syntax highlighting, multi-language support, read-only mode, theme sync
- Tests: Editor component tests, syntax highlighting tests

**PR10: Diff Viewer** (~2000 lines)
- Files: `src/renderer/features/diff/`
- Content: Side-by-side diff view, unified diff view, file change visualization, syntax-aware diff, navigation (next/prev change)
- Tests: Diff rendering tests, navigation tests

#### PR10 Detail: Diff Viewer Implementation

**Library**: `diff` npm package for diff computation (char-level + line-level)

**Two view modes**:
- Unified (default): single column with `+`/`-` line markers, added lines green-tinted, removed lines red-tinted
- Split (side-by-side): two columns — left = before, right = after; aligned by unchanged lines
- Toggle button in `DiffHeader` to switch between modes

**Navigation**:
- Next/prev change buttons (jump between diff hunks)
- Change count badge: `Change 3 of 12`
- Keyboard shortcuts: `Alt+Down` next, `Alt+Up` prev

**File stats header** (`DiffHeader`):
- File path (clickable → open in editor)
- `+N added, -M removed` line count badges
- File extension icon (language-specific)
- View mode toggle (unified ↔ split)

**Minimap overview** (`DiffMinimap`):
- Thin vertical bar showing full file with colored change markers
- Click to jump to change region
- Only shown for files >100 lines

**Syntax-aware highlighting**:
- Leverages Monaco grammars for language detection
- Syntax tokens preserved within added/removed lines

**Inline Diff (in chat — from PR8)**:
- Already defined in PR8 File Edit Tool spec
- Unified view inline in message, expandable/collapsible
- Syntax-colored added/removed lines

**PR11: MCP Management UI** (~1800 lines)
- Files: `src/renderer/features/mcp/`, `src/main/ipc/routers/mcp.ts`
- Content: MCP server list, add/remove server forms, server status display, tool discovery per server, configuration editor
- Tests: MCP UI tests, server management tests

### Wave 4: Skills + Stats (2 PRs, parallel, requires Wave 2)

These PRs only depend on Wave 1 (tRPC, DB, React skeleton) and Wave 2 (SDK host). They are independent of Wave 3 features.

**PR12: Plugin Management + Skills/Slash Commands UI** (~2500 lines)
- Files: `src/renderer/features/skills/`, `src/main/ipc/routers/skills.ts`, `src/main/sdk/pluginHost.ts`
- Content:
  - **Plugin lifecycle management**: Install, uninstall, enable, disable, update plugins with robust state tracking
  - **Plugin status dashboard**: Lists all installed plugins with real-time status (loaded/error/loading), shows each plugin's contributed skills, agents, tools
  - **Plugin health monitoring**: Detects load failures, missing dependencies, version conflicts — shows clear error messages with fix suggestions
  - **Plugin persistence**: Plugin state persisted in SQLite — survives app restarts, no "loaded plugins disappear" bugs
  - **Plugin isolation**: Each plugin loaded in isolated context — one plugin's crash doesn't affect others
  - **Skill discovery**: Exposes CLI's skill discovery system (file-based `.claude/skills/`, plugin-contributed, bundled, MCP) via tRPC
  - **Skill list UI**: Searchable/filterable list of all available skills with `/slash` prefix, categories, source indicator (which plugin provides it)
  - **Skill execution**: Click or type `/skillname` to invoke with arguments; execution via SDK host
  - **Integration**: Slash command autocomplete in chat input (type `/` → dropdown of matching skills, shows which plugin provides each)
- Tests: Plugin lifecycle tests (install/uninstall/enable/disable), plugin isolation tests, skill discovery tests, autocomplete tests, skill execution tests, plugin crash recovery tests

**PR13: Stats Dashboard with Graphs** (~2500 lines)
- Files: `src/renderer/features/stats/`, `src/main/ipc/routers/stats.ts`
- Dependencies: `recharts` (chart library)
- Content:
  - **Overview tab**: Summary cards (total sessions, total tokens, total cost, active days, current streak), GitHub-style activity heatmap, peak activity hours
  - **Models tab**: Per-model token usage bar/line charts, cost breakdown pie chart, model comparison table
  - **Session stats**: Real-time stats panel visible in every chat session — tokens used this session, running cost, duration
  - **Date range filter**: 7 days / 30 days / all time selector
  - **Data source**: Reads same `.jsonl` session files + SDK token tracking as CLI `/stats` command, served through tRPC statsRouter
  - **Auto-display**: Stats overview cards auto-render at chat session start (first message or session open)
  - **Charts**: Recharts library — responsive, animated, themed (dark/light mode compatible)
- Tests: Stats data processing tests, chart rendering tests, date range filter tests

### Wave 5: Polish & Distribution (3 PRs, parallel, requires Wave 3 + 4)

**PR14: UX Polish + Animations** (~1500 lines)
- Files: Various `src/renderer/` files
- Content: Loading states, transitions, keyboard shortcuts, accessibility improvements, empty states, error states
- Tests: Keyboard shortcut tests, a11y tests

**PR15: Auto-updater + Deep Linking** (~1200 lines)
- Files: `src/main/services/`
- Content: electron-updater integration, protocol handler (`openclaude://`), beta channel support, update notification UI
- Tests: Protocol handler tests, updater tests

**PR16: Test Suite** (~2500 lines)
- Files: `tests/`
- Content: Comprehensive unit tests, integration tests, component tests, test utilities, mock factories, CI test scripts
- Tests: Meta — this IS the tests

### Wave 6: Packaging (1 PR, requires Wave 5)

**PR17: Build Pipeline + CI** (~1500 lines)
- Files: `.github/workflows/`, `scripts/`, `electron-builder.yml`
- Content: electron-builder config, multi-platform build (macOS, Windows, Linux), code signing setup, GitHub Actions CI pipeline, release automation
- Tests: Build smoke tests

### Total: 17 PRs, 6 Waves, ~33,500 lines

### Parallel Safety

Each wave's PRs touch different directories:

| Wave | PR1 dir | PR2 dir | PR3 dir | PR4 dir |
|------|---------|---------|---------|---------|
| 1 | `main/index` | `shared/`+`preload/` | `main/db/` | `renderer/` |
| 2A | `main/sdk/`+`main/ipc/routers/` | `renderer/features/settings/` | — | — |
| 2B | `renderer/features/chat/`+`renderer/features/projects/` | `renderer/features/tools/` | — | — |
| 3 | `renderer/features/editor/` | `renderer/features/diff/` | `renderer/features/mcp/` | — |
| 4 | `renderer/features/skills/` | `renderer/features/stats/` | — | — |

**Dependency order within Wave 2**: Phase A (PR5 SDK Host + PR6 Settings) must merge before Phase B (PR7 Chat UI + PR8 Tool UI). Chat UI and tool rendering are meaningless without an active provider connection and API key.

PR7 (Chat + Projects) combines chat UI and project selection because the new-chat flow requires both — user picks a folder then starts chatting.

Wave 3 and Wave 4 can partially overlap — Wave 4 PRs only depend on Wave 1 + 2 (tRPC, DB, SDK host, React skeleton), not on Wave 3 features (editor, diff, MCP).

## 8. Technology Stack Summary

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Electron | ^39 |
| Build | electron-vite | ^3 |
| Package | electron-builder | ^26 |
| Frontend | React | 19.x |
| Styling | Tailwind CSS | 4.x |
| Components | Radix UI + shadcn | latest |
| State | Jotai + Zustand | latest |
| IPC | tRPC | 11.x |
| Database | better-sqlite3 + Drizzle ORM | latest |
| Editor | Monaco Editor | latest |
| Charts | Recharts | latest |
| Testing | Vitest + React Testing Library | latest |
| Language | TypeScript | 5.9+ |

## 9. Branding & Design System (Website Alignment)

The desktop app must share a unified visual identity with the OpenClaude website (https://openclaude.gitlawb.com/). All UI surfaces — splash screen, sidebar, chat, settings, dialogs — must follow the same design language.

### 9.1 Design Philosophy

The website's aesthetic is **monospace-first, terminal-inspired, minimal**. It uses a warm orange accent on a light background with sharp (unrounded) corners and dashed divider lines. The desktop app must replicate this feeling — not a generic dark SaaS app, but a developer tool with a distinctive hacker/terminal vibe.

### 9.2 Typography

**Primary font stack** (entire UI):
```
font-family: SF Mono, Fira Code, Fira Mono, Roboto Mono, Courier New, monospace;
```

- Google Fonts import: `Fira+Code:wght@400;500;600;700`
- `font-feature-settings: "ss01", "ss02", "cv01", "cv11"` (OpenType stylistic sets for better monospace readability)
- `font-synthesis: none; text-rendering: optimizelegibility`
- Logo text uses same monospace stack (no separate display font like Outfit)

**Font sizes** (from website, adapt for desktop):

| Usage | Size | Weight | Letter Spacing |
|-------|------|--------|----------------|
| Hero / Splash title | `clamp(2.4rem, 6vw, 4.4rem)` | 700 | `-0.04em` |
| Section headings | `clamp(1.6rem, 3vw, 2.1rem)` | 600 | `-0.025em` |
| Brand / Logo | `0.95rem` | 600 | `-0.01em` |
| Feature titles | `0.9rem` | 600 | `-0.005em` |
| Body text | `0.88rem` | 400 | — |
| Buttons | `0.8rem` | 500 | `0.01em` |
| Nav links | `0.78rem` | 400 | — |
| Eyebrow / Label | `0.72rem` | 500 | `0.04em` |
| Caption / Quiet | `0.74rem` | 400 | `0.02em` |
| Version tag | `0.7rem` | 400 | — |

**Line heights**: Hero `1`, Headings `1.15`, Body `1.65`, Buttons `1`

### 9.3 Color System

#### Accent Colors (constant across themes)

| Token | Value | Usage |
|-------|-------|-------|
| `--accent` | `#ff7a1a` | Primary orange — buttons, links, active states, focus rings, badges |
| `--accent-2` | `#ffb15f` | Lighter orange — inline code text, secondary highlights |
| `--accent-soft` | `#ff7a1a24` | Accent at ~14% opacity — box shadows, subtle backgrounds |
| `--accent-line` | `#ff7a1a66` | Accent at ~40% opacity — borders on interactive elements |

#### Light Theme (default)

| Token | Value | Notes |
|-------|-------|-------|
| `--bg` | `#fbfaf7` | Warm off-white background |
| `--bg-elev` | `#fbfaf7e0` | Same at ~88% — frosted header/sidebar |
| `--bg-soft` | `#ff7a1a0d` | Accent at ~5% — subtle tinted backgrounds |
| `--ink` | `#1a1208` | Near-black, warm brown — primary text |
| `--ink-2` | `#1a1208e0` | Primary text at 88% opacity |
| `--muted` | `#1a1208a3` | Body text at ~64% opacity |
| `--quiet` | `#1a120875` | Caption text at ~46% opacity |
| `--line` | `#1a12081a` | Borders at ~10% opacity |
| `--line-strong` | `#ff7a1a4d` | Accent border at ~30% opacity |
| `--hero-glow` | `#ff7a1a47` | Text shadow glow at ~28% |
| `--hero-wash` | `#ff7a1a2e` | Body gradient wash at ~18% |
| `--hero-wash-2` | `#ffb15f1a` | Second gradient wash at ~10% |
| `--copy-bg` | `#fff` | Pure white — code blocks, inputs |
| `--selection-fg` | `#fff` | White text on orange selection |
| `--scroll-thumb` | `#d8c9bc` | Warm beige scrollbar |

#### Dark Theme

| Token | Value | Notes |
|-------|-------|-------|
| `--bg` | `#000` | Pure black |
| `--bg-elev` | `#000000d9` | Black at ~85% — frosted surfaces |
| `--bg-soft` | `#ffffff06` | White at ~2% |
| `--ink` | `#fff` | Pure white |
| `--ink-2` | `#ffffffd1` | White at ~82% |
| `--muted` | `#ffffff8c` | White at ~55% |
| `--quiet` | `#ffffff61` | White at ~38% |
| `--line` | `#ffffff1a` | White at ~10% |
| `--line-strong` | `#fff3` | White at ~20% |
| `--hero-glow` | `#ff7a1a38` | Accent at ~22% |
| `--hero-wash` | `#ff7a1a29` | Accent at ~16% |
| `--hero-wash-2` | `#ff7a1a0f` | Accent at ~6% |
| `--copy-bg` | `#00000080` | Black at 50% |
| `--selection-fg` | `#120804` | Dark brown on selection |
| `--scroll-thumb` | `#3a2615` | Warm dark brown |

### 9.4 Theme Toggle

- **Default theme**: Light (`#fbfaf7` background)
- **Toggle**: `data-theme="light"` / `data-theme="dark"` on `<html>` element
- **Persistence**: `localStorage` key `openclaude-theme`
- **Bootstrap**: Inline `<script>` before paint to prevent flash
- **Toggle UI**: Small square button (28x28px) with `☀`/`🌙` icons, bordered, top-right nav position
- **Transitions**: `background-color 0.25s, color 0.25s` on `html` and `body`

### 9.5 Borders & Shapes

- **Border radius**: None — all elements are sharp-cornered (buttons, cards, inputs, modals, dropdowns)
- **Primary border style**: `1px solid var(--line)` for section separators
- **Signature style**: `1px dashed var(--line)` for decorative dividers (nav rule, footer)
- **Interactive borders**: `1px solid var(--accent-line)` for copy-cmd, hero eyebrow, active inputs
- **Focus outline**: `1px solid var(--accent); outline-offset: 3px`

### 9.6 Key UI Components (Website Reference)

#### Nav Bar
- Height: 64px, sticky, frosted glass (`backdrop-filter: blur(14px)`)
- Background: `var(--bg-elev)` (semi-transparent)
- Logo: 36px icon + brand name in monospace
- Links: muted color → ink on hover
- Theme toggle: 28x28px bordered square, right side

#### Buttons
- Height: 44px, **no border-radius** (sharp rectangles)
- Ghost variant: transparent bg, `var(--line-strong)` border, ink text
- Hover: `var(--ink)` border + `#ffffff0a` background overlay
- Active/pressed: Accent border + accent text

#### Code / Copy-Cmd Blocks
- Height: 44px (48px hero variant)
- Border: `1px solid var(--accent-line)`
- Background: `var(--copy-bg)`
- Shadow: `0 8px 24px -16px var(--accent-soft)`
- Hover: accent border + stronger shadow

#### Feature/Settings Rows
- Top+bottom border: `1px solid var(--line)`
- Two-column grid: label (180px/32%) + description
- Hover: subtle background change

#### Scrollbar
- Width: 3px (minimal)
- Track: `var(--bg)`, Thumb: `var(--scroll-thumb)`

#### Selection
- `::selection { background: var(--accent); color: var(--selection-fg); }`

### 9.7 Body Background (Desktop Adaptation)

The website uses radial gradients for warm ambient glow:
```css
background:
  radial-gradient(circle at 78% -4%, var(--hero-wash), transparent 420px),
  radial-gradient(circle at 12% 18%, var(--hero-wash-2), transparent 360px),
  var(--bg);
```
Desktop should apply similar gradients to main content areas (chat background, settings background).

### 9.8 Splash Screen

- Font: Fira Code monospace
- Text: "OpenClaude" in brand weight (600-700)
- Color: `var(--ink)` with `text-shadow: 0 0 28px var(--hero-glow)` glow
- Background: `var(--bg)` (light: `#fbfaf7`, dark: `#000`)
- Subtle pulse animation, fade out on load

### 9.9 PR4 Rebranding Checklist

When rebranding the PR4 UI to match this design system, apply ALL of the following:

- [x] **Font**: Replace `Inter` + `Outfit` with `Fira Code` monospace stack everywhere
- [x] **Accent**: Replace `#0034FF` (blue) with `#ff7a1a` (orange) in all theme tokens
- [x] **Colors**: Replace zinc palette with warm `#1a1208`-based light theme + `#000` dark theme
- [x] **Theme toggle**: Add light/dark switch (default light) with `localStorage` persistence
- [x] **Border radius**: Remove all `border-radius` — everything sharp-cornered
- [x] **Border style**: Replace solid dividers with dashed where appropriate
- [x] **Focus rings**: Use `1px solid var(--accent); outline-offset: 3px`
- [x] **Selection**: Orange selection color
- [x] **Splash screen**: Monospace text, orange glow, light background
- [x] **Sidebar**: Warm colors, monospace font, dashed dividers
- [x] **Chat input**: Sharp corners, orange focus glow instead of blue
- [x] **Model/Mode dropdowns**: Sharp corners, orange accent, monospace
- [x] **Settings**: Warm palette, dashed separators, sharp cards
- [x] **Scrollbars**: 3px width, themed thumb color
- [x] **Scrollbar**: Minimal 3px custom scrollbar
- [x] **Body gradients**: Add radial orange wash gradients
- [x] **Title bar**: Frosted glass effect, warm colors
- [x] **Logo**: Monospace font instead of Outfit
- [x] **All interactive elements**: Orange accent on hover/focus/active states

*Completed in PR4 draft branch (`desktop/pr4-react-ui-shell`).*

## 10. Constraints and Non-Goals

### Constraints
- Each PR: 1000-3000 lines including tests
- PRs within a wave must not modify the same files
- Must work on macOS, Windows, Linux
- SDK consumed as-is — no SDK modifications required
- No embedded terminal (external terminal only)

### Non-Goals (for initial release)
- Multi-window support (single window first)
- Worktree isolation (single workspace)
- Voice/speech recognition
- Mobile companion app
- Cloud sync
- Plugin/extension system
- Embedded rich text editor (TipTap/Lexical) — plain textarea + mention chips only
- Web preview / device simulation
- Sub-chat / threaded conversations