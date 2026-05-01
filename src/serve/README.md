# openclaude serve

HTTP/SSE server that exposes OpenClaude as an agent backend for the Obsidian plugin (and future clients).

## Usage

```
openclaude serve --port 7777
openclaude serve              # random port, prints JSON with URL
```

On startup the server:
1. Generates a 256-bit token in `~/.openclaude/server-token` (mode `0600` on Unix)
2. Binds to `127.0.0.1` only (never `0.0.0.0`)
3. Prints `{"type":"server-started", "url":"...", "port":...}` to stdout

## Authentication

All endpoints except `/health` require:

```
Authorization: Bearer <token>
```

Read the token from `~/.openclaude/server-token`. The plugin reads the same file automatically.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness check (public, no auth) |
| GET | `/config` | Server config (permissions preset, backup retention, rate limit) |
| POST | `/config` | Merge-update config |
| GET | `/models` | Available models + current model |
| POST | `/models/current` | Change current model `{modelId}` |
| GET | `/vaults` | Registered vaults |
| POST | `/vaults` | Register vault `{name, path}` |
| DELETE | `/vaults/:name` | Unregister vault |
| GET | `/sessions` | List chat sessions (newest first) |
| POST | `/sessions` | Create session → `{id, createdAt}` |
| GET | `/sessions/:id` | Get session with full message history |
| DELETE | `/sessions/:id` | Delete session |
| POST | `/chat` | Stream agent response (SSE). Body: `{message, sessionId?, context?}` |
| GET | `/pending-edits` | List edits awaiting approval |
| POST | `/pending-edits/:id/apply` | Apply edit (creates shadow backup first, 409 on conflict) |
| POST | `/pending-edits/:id/reject` | Discard edit |
| GET | `/backups?vault=<path>` | List backups for a vault |
| GET | `/backups/:id?vault=<path>` | Get backup entry |
| POST | `/backups/:id/restore?vault=<path>` | Restore file from backup |
| POST | `/tools/search` | Cross-vault text search `{query, vaults[], maxResults?}` |
| POST | `/tools/dataview` | Generate DQL from natural language `{naturalLanguage}` |
| POST | `/tools/analyze-results` | LLM insight from Dataview results `{dql, results[]}` |
| POST | `/tools/mermaid-graph` | Mermaid graph from seed note `{vault, seedNote, depth?, maxNodes?}` |

## SSE Stream Format (`POST /chat`)

Events are newline-delimited JSON:

```
event: token
data: {"text":"Hello "}

event: tool_call
data: {"id":"tc1","name":"Grep","args":{...}}

event: tool_result
data: {"id":"tc1","ok":true,"preview":"3 matches"}

event: pending_edit
data: {"id":"pe1","file":"/vault/note.md","reason":"expanding section"}

event: done
data: {"sessionId":"uuid","finishReason":"stop"}

event: error
data: {"code":"INTERNAL","message":"..."}
```

## Security Model

| Layer | Mechanism |
|---|---|
| Network | Bind `127.0.0.1` only — never reachable from other machines |
| Auth | Bearer token (constant-time compare) |
| CORS | Restricted to `app://obsidian.md` |
| Rate limit | 100 req/min/IP (configurable via `/config`) |
| Tripwires | Blocks `rm -rf`, git credential ops, writes to `~/.claude/settings.json` |
| Path safety | Vault-bound resolver rejects `..` traversal |

## State Directories (created at runtime, NOT in repo)

```
~/.openclaude/
  server-token          # 64-char hex, mode 0600 on Unix
  server-config.json    # persisted config overrides
  model-override.json   # current model override
  vaults.yml            # registered vaults
  sessions/<id>.jsonl   # chat history (JSONL, append-only)
  pending-edits/<id>.json
<vault>/.openclaude-backups/
  index.json            # backup index
  <timestamp>-<hash>-<slug>.md  # backup files, 30-day retention
```

## Development

```bash
# Run all server tests
bun run test:serve

# Run typecheck (zero errors expected in src/serve/)
bun run typecheck

# Build and start server
bun run build
node dist/cli.mjs serve --port 7777

# Quick smoke
TOKEN=$(cat ~/.openclaude/server-token)
curl -s http://127.0.0.1:7777/health
curl -sN -X POST http://127.0.0.1:7777/chat \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"oi"}'
```

## Out of Scope for Phase 1

- Permission preset enforcement inside agent loop (Plan #4)
- Streaming cancellation via DELETE (Plan #2)
- Audit log writer (Plan #4)
- Obsidian plugin UI (Plan #2)
- CLI installer `openclaude obsidian install` (Plan #4)
