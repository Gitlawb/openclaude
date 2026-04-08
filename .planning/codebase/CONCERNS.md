# CONCERNS

## Current Remote Control Limitations
### 1. PTY-centric synchronization only
- The current Remote Control websocket protocol only moves raw terminal traffic (`connect`, `input`, `resize`, `output`, `exit`, `error`) (`src/web/server.ts`).
- There is no semantic session model for messages, approvals, tool calls, partial status, or replay.
- This is the main architectural gap for true shared-session live sync.

### 2. Session state split across modules
- Session metadata is stored in `remoteControlService`, but live PTY ownership is managed separately in `server.ts` (`src/web/remoteControlService.ts`, `src/web/server.ts`).
- Browser state is managed independently in the inline script inside `src/web/static/index.html`.
- This makes reconnects, observer/controller roles, and deterministic state recovery harder.

### 3. Overloaded server module
- `src/web/server.ts` currently handles static file serving, REST API routes, websocket protocol, PTY lifecycle, and session cleanup in one file.
- It is already a hotspot and likely to become brittle if more live-sync behavior is added directly without decomposition.

## Frontend Maintainability Concerns
- The browser UI is a single HTML file with inline CSS and JavaScript (`src/web/static/index.html`).
- This is fast for prototyping but becomes awkward for richer sync logic, multi-client state handling, and testability.
- Any growth in UI complexity risks making the browser side the next hotspot.

## Persistence / Recovery Gaps
- Persisted Remote Control state currently only tracks server PID, port, local URL, and public URL (`src/web/remoteControlState.ts`, `src/utils/config.ts`).
- There is no persisted session event log or recoverable semantic snapshot.
- If the process dies or the browser reconnects mid-session, fidelity is currently limited.

## Testing Gaps
- Existing tests validate API/session behaviors and some server/websocket flows, but not multi-client synchronization semantics.
- There is no existing test harness for event replay, sequence ordering, or controller arbitration.
- A live-sync feature will need careful test expansion to avoid race-condition regressions.

## Compatibility / Runtime Concerns
- OpenClaude ships a Node-targeted bundle but uses Bun for build/test (`scripts/build.ts`, `package.json`).
- Remote Control PTY spawning explicitly resolves `node.exe` instead of trusting `process.execPath`, which signals platform-specific fragility already exists (`src/web/server.ts`).
- Any new sync layer should avoid introducing Bun-only runtime assumptions into shipped code.

## Security / Exposure Concerns
- Remote Control already exposes a local HTTP server and websocket endpoint (`src/web/server.ts`).
- Tunnel support is scaffolded, and future remote exposure is implied, so protocol design should assume that browser-side events may eventually cross less-trusted boundaries.
- Input authority and event validation will matter more once multiple clients and semantic actions are supported.

## Brownfield Risks for This Feature
- The repository is mature and broad; Remote Control is only one subsystem among many. Tight coupling to `main.tsx` or unrelated internals would raise maintenance cost quickly.
- There are existing task/state abstractions elsewhere in the repo that may partially solve similar lifecycle concerns, but they are not yet integrated with Remote Control.
- The current feature branch already contains in-progress Remote Control changes, so implementation must be careful not to overwrite or bypass uncommitted work.

## Recommended Guardrails
- Introduce a dedicated session coordinator/event bus layer instead of embedding more state directly in `server.ts`.
- Keep snapshot/state projection types explicit and shared via `src/web/remoteControlTypes.ts` or closely related files.
- Preserve a narrow MVP: multiple web viewers, one controller, short replay window, no full durable history at first.
- Add tests for ordering, reconnection, and controller authority before expanding scope.
