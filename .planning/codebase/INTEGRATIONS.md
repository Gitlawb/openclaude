# INTEGRATIONS

## External Model and API Providers
- Anthropic SDK is the primary native client path (`src/services/api/client.ts`).
- OpenAI-compatible, GitHub Models, Gemini, Bedrock, Vertex, Foundry, Ollama, and Atomic Chat are supported through provider shims and routing (`README.md`, `package.json`, `src/services/api/client.ts`, `src/utils/model/providers.ts`).
- Provider behavior is configured through environment variables, saved profiles, and startup env hydration (`src/entrypoints/cli.tsx`, `src/utils/config.ts`, `README.md`).

## Auth and Credential Surfaces
- OAuth account/token flows are wired into startup and API client initialization (`src/entrypoints/init.ts`, `src/services/api/client.ts`).
- Secure storage hydration exists for Gemini and GitHub Models in startup (`src/entrypoints/cli.tsx`).
- API keys and cloud credentials may come from env vars, profile config, or provider-specific auth helpers (`src/services/api/client.ts`).

## MCP and Tooling Ecosystem
- MCP servers are a first-class integration surface, with config loaded via project/global settings and dedicated tooling under `src/services/mcp/` and `src/tools/MCPTool/` (`src/utils/config.ts`, `src/main.tsx`, `src/tools/`).
- Skills can come from bundled sources, project/user settings, plugins, and MCP-driven builders (`src/skills/loadSkillsDir.ts`).

## Remote Control Browser Integration
- Remote Control exposes an HTTP API and WebSocket endpoint for browser clients (`src/web/server.ts`).
- Static assets are served from `src/web/static/index.html` and loaded directly in the browser (`src/web/server.ts`, `src/web/static/index.html`).
- Browser terminal rendering relies on CDN-hosted xterm assets from jsDelivr, not local vendored packages (`src/web/static/index.html`).

## Git and Worktree Integration
- Remote Control session creation can create isolated worktrees via `createAgentWorktree` and remove them through `removeAgentWorktree` (`src/web/remoteControlService.ts`).
- The broader app also contains worktree-aware session handling and git-root detection (`src/utils/config.ts`, `src/main.tsx`).

## Tunnel / Remote Access Integration
- Remote Control has a tunnel abstraction in `src/web/tunnel.ts`.
- Current open-build implementation is effectively a stub: tunnel start returns an error that `cloudflared` is missing, and status/stop are simple local state transitions (`src/web/tunnel.ts`).
- Startup still exposes `publicUrl` plumbing, so the interface anticipates remote publishing even if the implementation is incomplete in this branch (`src/web/remoteControlLauncher.ts`, `src/commands/bridge/bridge.tsx`).

## Filesystem Integration
- Remote Control exposes a directory browser over `/api/browse` for new session creation (`src/web/server.ts`).
- Static file serving resolves paths carefully and rejects traversal outside the designated static directory (`src/web/server.ts`).
- Project config persists Remote Control local state into the normal config system (`src/web/remoteControlState.ts`, `src/utils/config.ts`).

## CI / Development Tooling
- GitHub Actions runs install, smoke, full unit tests, security PR scan, and provider-specific tests (`.github/workflows/pr-checks.yml`).
- Local development uses Bun scripts for build, smoke, provider test subsets, and coverage (`package.json`, `README.md`).

## Potential Integration Constraints for Live Sync Work
- Any new live-sync layer should fit the existing embedded-server model rather than assume a separate backend service.
- Browser dependencies are currently minimal and inline; introducing a larger frontend framework would be a bigger architectural shift than the current system suggests.
- Worktree lifecycle, provider auth, and config persistence are already integrated surfaces that a shared-session design should reuse instead of bypassing.
