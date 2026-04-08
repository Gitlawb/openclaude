# ARCHITECTURE

## High-Level Shape
- OpenClaude is a terminal-first coding-agent application with a large modular runtime centered on `src/main.tsx`.
- Startup begins in `src/entrypoints/cli.tsx`, which performs early environment/config/provider handling, gates special modes, and then loads the main application.
- The app is organized around commands, tools, services, state, and utilities, with heavy use of feature flags and lazy imports for optional capabilities (`src/entrypoints/cli.tsx`, `src/main.tsx`, `scripts/build.ts`).

## Main Runtime Layers
### 1. Entrypoints / bootstrap
- `src/entrypoints/cli.tsx` is the primary CLI bootstrap.
- `src/entrypoints/init.ts` handles early configuration, safe env setup, network/proxy/bootstrap side effects, cleanup registration, and subsystem initialization.

### 2. Main application shell
- `src/main.tsx` assembles the command-line app, provider behavior, telemetry, settings, tool setup, and interactive rendering.
- This file is large and acts as the orchestration center for many subsystems.

### 3. Command layer
- Slash/local commands are registered centrally in `src/commands.ts`.
- Individual commands live in `src/commands/*`, typically as isolated modules with lazy-loaded implementations.
- Remote Control is surfaced as a local JSX command under `src/commands/bridge/` and as a CLI fast-path in `src/entrypoints/cli.tsx`.

### 4. Tool layer
- Tools are modularized under `src/tools/` with one directory per tool family.
- The system includes file tools, Bash, Agent, Skill, Task, plan/worktree tools, MCP tools, and more.
- This suggests the codebase already models structured user-facing actions and status transitions explicitly.

### 5. Services and utilities
- `src/services/` contains domain-specific runtime integrations such as APIs, analytics, policy limits, MCP, and other infrastructure concerns.
- `src/utils/` contains the shared platform substrate: config, auth, permissions, git/worktree helpers, model logic, error utilities, etc.

### 6. State and task systems
- App state is handled under `src/state/` using a store + selector/change-listener pattern (`src/state/store.ts`, `src/state/AppStateStore.ts`).
- Background/agent task concepts are modeled under `src/tasks/`, indicating an existing internal vocabulary for long-running work and status observation.

## Remote Control Subsystem Architecture
### Current topology
- `src/web/remoteControlLauncher.ts` starts or reveals the local web app and persists local state.
- `src/web/remoteControlService.ts` owns session metadata and worktree-backed session creation/cleanup.
- `src/web/server.ts` hosts the embedded HTTP API, static asset server, WebSocket server, and PTY process lifecycle.
- `src/web/static/index.html` is a single-file browser UI that renders a session list and an xterm terminal.

### Current session model
- A Remote Control session is currently a lightweight record with `id`, `label`, `source`, `cwd`, `status`, and optional worktree metadata (`src/web/remoteControlTypes.ts`).
- The service persists session metadata in memory only; PTY processes are tracked separately in `activePtys` inside `src/web/server.ts`.
- WebSocket attach is PTY-centric: browser sends `connect`, `input`, `resize`; server returns `connected`, `output`, `exit`, `error`.

### Current control flow
1. User launches Remote Control via slash command or `remote-control` CLI path (`src/commands/bridge/bridge.tsx`, `src/entrypoints/cli.tsx`).
2. Launcher ensures server health or starts embedded server and optional tunnel (`src/web/remoteControlLauncher.ts`).
3. Server auto-creates one default session for the current CLI working directory (`src/web/server.ts`).
4. Browser fetches `/api/sessions`, selects a session, and opens a WebSocket.
5. Server creates or reuses a PTY running `node dist/cli.mjs --continue` in the session cwd and forwards raw terminal traffic (`src/web/server.ts`).

## Architectural Pattern Observations
- The broader codebase favors modular subsystems with explicit boundaries, but Remote Control is still in an early sidecar stage.
- Remote Control has a split-brain model today: metadata is in `remoteControlService`, live PTY state is in `server.ts`, and browser state is entirely client-side.
- There is no shared semantic event model for session activity yet; only raw terminal websocket traffic plus coarse REST session management.

## Data Flow Patterns Relevant to New Work
- Existing CLI startup and command handling already use explicit status checks, feature gates, and lazy imports.
- Config/state writes typically flow through typed helper functions rather than ad hoc file operations (`src/utils/config.ts`, `src/web/remoteControlState.ts`).
- Tests often mock module boundaries and assert behavior at service/API level rather than only via end-to-end tests (`src/web/server.test.ts`, `src/web/remoteControlService.test.ts`).

## Architectural Implications for Live Sync
- The clean insertion point for shared-session synchronization is likely between the PTY process and browser websocket layer: an in-process session coordinator or event bus that both server and UI-facing APIs consume.
- `src/web/server.ts` is currently doing too many jobs (HTTP API, static serving, PTY orchestration, websocket protocol, session cleanup). If live sync grows, it will likely need internal decomposition even if external behavior stays the same.
- Because the application already has task/state abstractions elsewhere, a future semantic session model can likely borrow patterns from those systems instead of inventing entirely new lifecycle concepts.
