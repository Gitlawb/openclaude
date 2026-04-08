# STRUCTURE

## Repository Layout
- `bin/` — executable wrapper scripts for the packaged CLI.
- `docs/` — user-facing documentation, including setup docs and `docs/superpowers/` content.
- `scripts/` — build and maintenance scripts, including the Bun bundling pipeline (`scripts/build.ts`).
- `src/` — main application source.
- `vscode-extension/` — editor integration package.
- `.github/workflows/` — CI workflows.
- `.planning/` — GSD planning files (now being initialized in this worktree).

## Key Source Directories
### CLI and orchestration
- `src/entrypoints/` — bootstrap entrypoints (`cli.tsx`, `web.ts`, `init.ts`).
- `src/main.tsx` — primary app composition/orchestration.
- `src/commands.ts` — central command registry.

### User commands
- `src/commands/` — per-command implementations.
- Remote Control command currently lives under `src/commands/bridge/` with `bridge.tsx`, `index.ts`, and tests.

### Web / remote control
- `src/web/` — embedded web server, remote control launcher/state/service/types, tunnel support, tests, and static assets.
- `src/web/static/` — current browser UI (`index.html`).

### Tools and agent interfaces
- `src/tools/` — tool implementations, one directory per tool type.
- Examples include `AgentTool/`, `BashTool/`, `FileReadTool/`, `TaskCreateTool/`, `SkillTool/`, and more.

### Runtime services
- `src/services/` — API, MCP, analytics, policy limits, plugin infrastructure, notifier, token estimation, and other service modules.
- `src/services/api/` is a major cluster for provider and request behavior.

### Application state and tasks
- `src/state/` — app state store and selectors.
- `src/tasks/` — task state types and task implementations.

### Shared platform utilities
- `src/utils/` — very large utility layer covering config, auth, git/worktrees, model/provider handling, permissions, hooks, telemetry, etc.

## File Naming and Placement Patterns
- Tests are frequently colocated using `*.test.ts` or `*.test.tsx` next to the code they validate (`src/web/server.test.ts`, `src/web/remoteControlService.test.ts`).
- Command folders often expose an `index.ts` registration file plus an implementation file (`src/commands/bridge/index.ts`, `src/commands/bridge/bridge.tsx`).
- Entrypoints are separated from reusable subsystem code (`src/entrypoints/cli.tsx` vs `src/web/*`).

## Current Remote Control File Map
- `src/entrypoints/web.ts` — thin startup entrypoint for remote control launch.
- `src/commands/bridge/index.ts` — command registration for `/remote-control`.
- `src/commands/bridge/bridge.tsx` — slash command handler and user-facing formatting.
- `src/web/remoteControlLauncher.ts` — startup/reveal logic and persisted local state.
- `src/web/remoteControlState.ts` — project config persistence for the local remote control process.
- `src/web/remoteControlService.ts` — session lifecycle for cwd/worktree-backed sessions.
- `src/web/server.ts` — HTTP server, API routes, PTY lifecycle, websocket handling, static serving.
- `src/web/remoteControlTypes.ts` — shared types.
- `src/web/tunnel.ts` — tunnel lifecycle abstraction.
- `src/web/static/index.html` — current browser UI.

## Centralization Hotspots
- `src/main.tsx` is a major orchestration hotspot and likely difficult to fully reason about without focused reads.
- `src/commands.ts` is the central command import/registration hotspot.
- `src/utils/config.ts` is the central configuration/types hotspot.
- `src/web/server.ts` is the current hotspot for all live Remote Control runtime behavior.

## Likely Modification Zones for Live Sync Feature
- `src/web/server.ts` — websocket protocol and PTY wiring.
- `src/web/remoteControlService.ts` and `src/web/remoteControlTypes.ts` — richer session/state types.
- `src/web/static/index.html` — browser sync/rendering behavior.
- `src/commands/bridge/bridge.tsx` — status/messaging if startup semantics change.
- Possibly new files under `src/web/` for event bus, session coordinator, state projection, and protocol separation if the design is decomposed cleanly.

## Structural Risks
- Remote Control browser UI is currently a single large HTML file with inline script/style, which makes richer shared-state behavior harder to evolve cleanly.
- The current remote-control backend logic is concentrated in one server file rather than a layered set of modules.
- There are many mature subsystems elsewhere in the repo, so new Remote Control work should avoid introducing inconsistent folder patterns or ad hoc naming.
