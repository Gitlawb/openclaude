# STACK

## Languages and Runtime
- Primary language is TypeScript across the CLI, web server, tool layer, and tests (`package.json`, `tsconfig.json`).
- Runtime is Node.js for the built artifact, with Bun used for development scripts, bundling, and tests (`package.json`, `scripts/build.ts`).
- The build targets modern JavaScript (`ES2022`, `ESNext`) with bundler-style module resolution and React JSX enabled (`tsconfig.json`).

## Build and Packaging
- Main package entry is `@gitlawb/openclaude`, exposed through `bin/openclaude` (`package.json`).
- Source build path is `bun run build`, which bundles `src/entrypoints/cli.tsx` into `dist/cli.mjs` (`scripts/build.ts`).
- The Bun build script inlines feature flags at build time via `bun:bundle` and uses shims/stubs for unavailable internal modules (`scripts/build.ts`).
- Distribution is a single bundled CLI artifact with `dist/cli.mjs` and a small bin wrapper (`package.json`, `scripts/build.ts`).

## Core Frameworks and Libraries
- CLI/UI layer uses React plus Ink-style rendering patterns in the main app (`package.json`, `src/main.tsx`).
- Command routing is Commander-based (`package.json`, `src/main.tsx`).
- Remote Control server uses Node `http`, `ws` for WebSockets, and `node-pty` for terminal sessions (`src/web/server.ts`).
- Validation and schema work uses `zod` and `ajv` in the broader codebase (`package.json`).
- HTTP/network work uses `axios`, `undici`, and the Anthropic/OpenAI-style client layers (`package.json`, `src/services/api/client.ts`).

## Project Structure Indicators
- CLI bootstrap and startup flow live under `src/entrypoints/` and `src/main.tsx`.
- Commands are organized under `src/commands/` with a central registry in `src/commands.ts`.
- Tools are implemented under `src/tools/` and include Bash, file, task, plan, MCP, web, and skill tool support (`src/tools/`).
- State management lives under `src/state/`.
- API/provider client code lives under `src/services/api/` and `src/utils/model/`.
- Remote Control web implementation currently lives in `src/web/`.

## Build-Time Feature Flags
- Open build enables `BRIDGE_MODE` and `BUDDY`, while many internal/Anthropic-only features stay disabled (`scripts/build.ts`).
- `claude remote-control` support is gated by `BRIDGE_MODE` and startup/runtime checks in the CLI entrypoint (`src/entrypoints/cli.tsx`, `scripts/build.ts`).

## Testing Stack
- Unit tests use Bun’s built-in test runner (`package.json`, `README.md`).
- Test files sit next to code in many areas, including remote control (`src/web/server.test.ts`, `src/web/remoteControlService.test.ts`, `src/commands/bridge/bridge.test.tsx`).
- CI runs smoke plus full unit tests on GitHub Actions using Node 22 and Bun 1.3.11 (`.github/workflows/pr-checks.yml`).

## Configuration and Persistence
- Project/global config flows through `src/utils/config.ts`.
- Per-project persisted state includes remote control local state and worktree session data (`src/utils/config.ts`).
- Provider selection and startup environment composition are handled through provider profile/config utilities (`package.json`, `src/entrypoints/cli.tsx`, `src/utils/model/`).

## Notable Dependencies Relevant to Current Work
- `node-pty` powers terminal session attachment for Remote Control (`package.json`, `src/web/server.ts`).
- `ws` powers browser/server websocket communication (`package.json`, `src/web/server.ts`).
- `react` and `@types/react` support command UIs and likely future web-adjacent rendering reuse (`package.json`).
- `xss` is available in dependencies, suggesting security-conscious handling for rendered content in some areas (`package.json`).

## Practical Takeaways
- This is a TypeScript-first CLI platform with a large modular runtime, not a small standalone web app.
- Remote Control is currently implemented as an embedded HTTP/WebSocket sidecar inside the CLI process, which makes it natural to add an in-process event bus rather than an external service first.
- Bun is the expected local dev/test toolchain, but runtime compatibility still matters for Node because the shipped artifact runs there.
