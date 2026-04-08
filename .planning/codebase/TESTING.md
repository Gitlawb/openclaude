# TESTING

## Primary Test Framework
- The repository uses Bun’s built-in test runner (`package.json`, `README.md`).
- Standard test helpers come from `bun:test`, including `test`, `expect`, `mock`, `beforeEach`, and `afterEach` (`src/web/server.test.ts`, `src/web/remoteControlService.test.ts`).

## Test Execution Commands
- Full test suite: `bun test` (`package.json`, `README.md`).
- Coverage: `bun test --coverage --coverage-reporter=lcov --coverage-dir=coverage --max-concurrency=1` (`package.json`).
- Provider-focused subset: `bun run test:provider` (`package.json`).
- Recommendation/profile subset: `bun run test:provider-recommendation` (`package.json`).
- Smoke build/runtime check: `bun run build && node dist/cli.mjs --version` via `bun run smoke` (`package.json`).

## CI Verification
- GitHub Actions workflow `pr-checks.yml` runs:
  - dependency install with frozen lockfile
  - smoke check
  - full unit tests with `bun test --max-concurrency=1`
  - security PR intent scan
  - provider tests
  - provider recommendation tests
- CI uses Node 22 plus Bun 1.3.11 (`.github/workflows/pr-checks.yml`).

## Test Organization
- Tests are mostly colocated next to implementation files.
- Remote Control examples:
  - `src/web/server.test.ts`
  - `src/web/remoteControlService.test.ts`
  - `src/web/remoteControlState.test.ts`
  - `src/commands/bridge/bridge.test.tsx`
- The naming pattern is consistent: `moduleName.test.ts` or `moduleName.test.tsx`.

## Testing Style in Remote Control Area
### API handler tests
- `src/web/server.test.ts` validates REST handler behavior, error cases, tunnel endpoints, and static server behavior.
- It stubs service dependencies rather than spinning the full real backend for every case.

### Service tests
- `src/web/remoteControlService.test.ts` focuses on business rules like max session count, worktree creation, cleanup behavior, and mutation safety.
- These tests mock worktree helpers using `mock.module()`.

### State/config tests
- `src/web/remoteControlState.test.ts` (present in repo structure) suggests persistence behavior is tested separately from session runtime.

## Common Patterns
- Dynamic import with a timestamp query is used to isolate module state between tests (`src/web/server.test.ts`, `src/web/remoteControlService.test.ts`).
- Mock cleanup via `mock.restore()` in `afterEach()` is standard.
- Assertions focus on returned values, HTTP response objects, websocket-facing behavior, and side-effect calls.

## Gaps Relevant to Live Sync Work
- Current tests cover PTY/websocket basics and session APIs, but there is no visible semantic event-bus or shared-session synchronization test layer yet.
- If live sync introduces richer session state, the codebase will benefit from a new layer of tests for:
  - event ordering
  - snapshot/replay correctness
  - reconnect behavior
  - multi-client attachment rules
  - single-controller enforcement

## Practical Testing Guidance
- Keep tests close to the new modules created for live sync.
- Preserve the existing behavioral style: assert public protocol and service outcomes, not internal implementation minutiae.
- Run at least the focused remote control tests plus smoke after changes in this area.
