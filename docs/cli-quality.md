# CLI quality checks

The shared `.github/workflows/cli-quality.yml` workflow is required by PR checks
and every release publication job. No test-failure baseline is accepted.
The existing `smoke-and-tests` check explicitly fails when this gate fails or is
cancelled; it cannot become a successful skipped check after a dependency fails.

## Agent consumption and completion

- `totalTokens`, `tokenCount`, `usage.total_tokens` and cost accounting contain
  confirmed consumption only. Estimates never enter billing fields.
- Optional `tokenUsage` / SDK `usage.token_usage` carries confirmed and estimated
  portions separately, plus `pending`, `estimated` or `reported` state.
- Before output arrives, show `Awaiting response`. During unreported streaming,
  show `~N tokens`. Complete official usage replaces the approximation, including
  an explicitly reported zero. Missing or partial usage remains approximate.
- Count input, output, cache reads and cache creation once per response attempt.
  Split assistant records, repeated cumulative usage and replayed tool calls must
  not duplicate consumption. Failed attempts and partial output remain visible.
- Progress updates are coalesced at 100 ms, with a final flush on all exit paths.
  SDK output wakes independently of the parent query yielding another message.
- Metadata writes are atomic and serialized. An execution identifier prevents a
  late callback from overwriting a resumed agent's metadata or task state.
- Display success, provider failure, user interruption and execution-budget
  limits distinctly. Closing task details must not cancel running agents.

## Automated coverage

| Layer | Checks |
| --- | --- |
| Isolated suites | Every tracked or new non-ignored `.test.ts`, `.test.tsx`, `.test.js`, `.test.mjs` file, including SDK, extension and desktop contracts |
| Runtime contracts | Late/partial/zero usage, retries, split messages, replay, background progress, cancellation, stale executions, persisted metadata |
| Stress | Seeded 10,000-event streams, 1/2/8/20 agents, bounded SDK progress queues with start and final events preserved |
| Rendered terminal | Compare changing Ink output against a Unicode-aware VT screen, with bounded group height and input retained |
| Installed CLI | Real npm tarball, actual agent/query/auth/parser paths, local HTTP/SSE server, PTY input and resize |
| Terminal matrix | Linux, macOS and Windows; Node 22 and 24; 40×12, 80×24 and 120×40; 1/2/8/20 agents; normal and fullscreen |
| Interaction/error cases | Missing/partial/explicit-zero usage, background completion, task menu/detail, draft preservation, resize, Esc, provider failure, configured maxTurns, streaming JSON |
| Other components | Python tests, web typecheck/build, existing native desktop checks |

The terminal fixture uses a fresh project and configuration, synthetic OAuth,
strict empty MCP configuration, disabled plugin installation and no provider
credentials. Only the HTTP destination is redirected; the production CLI bundle
is installed unchanged. Unexpected external HTTP attempts fail the fixture.
Use of real inference services is not required.

The scoped `tsconfig.agent-contracts.json` checks the new accounting, schema,
layout and runner contracts in strict mode. Repository-wide TypeScript debt from
the incomplete source type snapshot is a separate migration; this scoped check
does not claim that the global typecheck passes.

## Running and reviewing

```bash
bun install --frozen-lockfile
bun run test:quality
```

`CLI_TEST_NODE` can select a specific Node executable. The command checks that
the executing Bun matches `.bun-version`. `bun run test:isolated -- path/to/file.test.ts`
selects individual suites; a directory filter must end in `/`. Unknown filters
fail rather than silently running no tests.

Each isolated suite has its own process, configuration and temporary directory,
with a default 180-second deadline and process-tree cleanup. JSON and JUnit
results are saved in `.artifacts/test-results`. PTY captures, screen frames,
fixture requests and debug logs are saved in `.artifacts/pty` and uploaded on
both success and failure. These generated directories are git-ignored.
The temporary consumer installation is outside the repository; its location is
recorded in `.artifacts/package/consumer-path.txt` so it can be inspected or removed.

The suite job builds and packs once. All six terminal jobs install that same
tarball. Publication downloads it, verifies its SHA-256 checksum and publishes
the tarball with lifecycle scripts disabled, without rebuilding it. Docker and
desktop publication also depend on the complete gate; native desktop builds
retain their platform checks and mandatory Minisign signing.

Passing a local run validates that host only. The Linux/macOS/Windows matrix
must finish successfully in CI before release publication is enabled.
