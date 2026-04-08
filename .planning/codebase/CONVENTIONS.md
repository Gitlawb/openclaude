# CONVENTIONS

## Language and Module Style
- Code is TypeScript-first and uses ESM-style imports throughout the repo (`tsconfig.json`, `src/entrypoints/cli.tsx`).
- Source files typically import types with `import type` where appropriate (`src/commands/bridge/bridge.tsx`, `src/web/remoteControlService.ts`).
- Many files use explicit small helper functions to isolate formatting or error-message behavior rather than embedding everything inline (`src/commands/bridge/bridge.tsx`, `src/web/remoteControlLauncher.ts`).

## Naming Patterns
- Files generally use descriptive camelCase names for modules (`remoteControlLauncher.ts`, `remoteControlState.ts`, `providerValidation.ts`).
- Test files mirror the target module name with `.test.ts`/`.test.tsx` suffixes (`server.test.ts`, `remoteControlService.test.ts`).
- Command registration files often use `index.ts` and export a `Command` object with `satisfies Command` typing (`src/commands/bridge/index.ts`).

## Command Pattern
- Commands are centrally registered in `src/commands.ts`.
- Local JSX commands typically export a `call()` function that receives `onDone`, context, and args and returns `React.ReactNode | null` (`src/commands/bridge/bridge.tsx`).
- User-facing command output is often formatted in dedicated helpers before being sent via `onDone()`.

## Error Handling Style
- Error handling is usually direct and narrow in scope: catch, derive an error message, and return a clean message/object (`src/commands/bridge/bridge.tsx`, `src/web/remoteControlLauncher.ts`).
- APIs often return structured `{ statusCode, body }` objects rather than throwing for expected validation/conflict cases (`src/web/server.ts`).
- Service functions throw on invariant or resource-limit violations, and callers translate those into user/API-friendly responses (`src/web/remoteControlService.ts`, `src/web/server.ts`).

## State and Mutation Style
- Session/config reads often clone returned objects to avoid accidental mutation leaks (`src/web/remoteControlService.ts`, `src/web/remoteControlState.ts`).
- Config updates tend to go through functional update helpers (`saveCurrentProjectConfig(current => ...)`) instead of imperative file writes (`src/web/remoteControlState.ts`).
- Collections are commonly stored in `Map` and exposed via copied arrays or cloned values (`src/web/remoteControlService.ts`).

## Testing Conventions
- Bun test APIs (`test`, `expect`, `mock`, `beforeEach`, `afterEach`) are the standard test pattern (`src/web/server.test.ts`, `src/web/remoteControlService.test.ts`).
- Module mocking is common for boundaries like worktree helpers or tunnels (`src/web/remoteControlService.test.ts`, `src/web/server.test.ts`).
- Tests are behavioral: they assert returned responses, lifecycle changes, and protocol behavior rather than internal implementation details.

## Build / Feature Flag Conventions
- Feature flags are controlled through `feature('FLAG_NAME')` and inlined by the Bun build process (`scripts/build.ts`, `src/entrypoints/cli.tsx`).
- Comments often explain why a guard or polyfill exists, especially for platform/runtime compatibility (`src/entrypoints/cli.tsx`, `src/entrypoints/init.ts`).

## Security and Safety Conventions
- Static file serving explicitly validates resolved paths stay under the static directory (`src/web/server.ts`).
- Provider override code strips auth headers before forwarding to non-Anthropic endpoints, signaling explicit concern about credential leakage (`src/services/api/client.ts`).
- Config and permission handling are centralized rather than scattered, suggesting new risky behavior should integrate with existing config/policy surfaces (`src/utils/config.ts`, `src/utils/permissions/`).

## Practical Guidance for Changes
- Prefer small focused modules over growing `src/web/server.ts` further.
- Keep types centralized in shared `*Types.ts` files when used across backend and frontend/websocket boundaries.
- Follow the existing pattern of translating thrown service errors into HTTP/API conflict responses.
- Add colocated Bun tests whenever changing observable session/server behavior.
