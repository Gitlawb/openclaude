# Remote Session

Mirror one or more running openclaude sessions to your phone (or any
browser) over HTTP + WebSocket. See the live conversation, submit
prompts, and approve tool permissions from anywhere — while the model
keeps working on your local machine or VPS.

> This is the `/remote` slash command and its `localRemote` subsystem. It is
> **not** the Neural Network cloud bridge (`claude.ai` pairing) — that one polls
> outbound to an Anthropic-hosted API. `/remote` listens locally and gives
> you full control of the transport, auth, and data.

---

## Architecture

The system has three actors:

1. **Daemon** — a standalone background process that holds the HTTP+WS
   port. It routes messages between workers and browser clients, serves
   the PWA, and exposes `/api/sessions` for session discovery.
2. **Worker** — each running openclaude process that has typed `/remote on`.
   It connects outbound to the daemon over WebSocket and registers its
   session.
3. **Browser client** — the Vue PWA (or any scripted client). Connects to
   the daemon, gets a session list, picks one, and communicates with it.

```
┌──────────────┐  WS /ws/client  ┌──────────────────────┐  WS /ws/worker  ┌───────────────┐
│  Phone PWA   │<═══════════════>│    Daemon process     │<═══════════════>│  openclaude A │
│   or curl    │                 │  (HTTP + WS + auth)   │                 │  (worker)     │
└──────────────┘                 │                       │                 └───────────────┘
                                 │  GET /api/sessions    │  WS /ws/worker  ┌───────────────┐
                                 │  GET /healthz         │<═══════════════>│  openclaude B │
                                 └──────────────────────┘                 │  (worker)     │
                                                                          └───────────────┘
```

---

## Quick start (local PC)

1. Start openclaude in a terminal as usual.
2. Type `/remote on`.
   - If no daemon is running, one is auto-spawned in the background.
   - The worker connects to the daemon.
3. Copy the URL and token that get printed:
   ```
   Connected to remote daemon.
     URL:   http://localhost:7842
     Token: R4uL...base64url...bAQ
   ```
4. Open the URL in a browser, paste the token, click **Connect**.
5. The browser shows a **session list**. Click your session.
6. Type a prompt — it appears in the TUI and the model responds. Tool
   permission prompts also show up as **Allow / Deny** buttons.

### Multiple sessions

Open a second terminal, run another openclaude, type `/remote on`.
Refresh the browser — both sessions appear in the list. Switch between
them freely.

To stop: `/remote off` in the TUI disconnects that worker from the
daemon. The daemon keeps running for other workers.

---

## Daemon management

The daemon is auto-started on the first `/remote on`, but you can
also manage it explicitly:

| Command                              | Effect                                   |
| ------------------------------------ | ---------------------------------------- |
| `openclaude remote-daemon`           | Start daemon in foreground (for systemd) |
| `openclaude remote-daemon --stop`    | Send SIGTERM to the running daemon       |
| `openclaude remote-daemon --status`  | Print daemon URL, PID, session count     |

The daemon writes a PID file to `~/.claude/remote-daemon.pid`.

### Auto-spawn

When `/remote on` finds no daemon:
1. The worker probes `GET /healthz` on the configured port.
2. If unreachable, it atomically locks the PID file and spawns the
   daemon as a detached background process.
3. Polls `/healthz` for up to 3 seconds, then connects.
4. If multiple workers race, only one spawns; the rest wait.

### Auto-heal

If the daemon crashes:
- Workers detect the WebSocket disconnect.
- They retry with exponential backoff (250ms → 5s).
- If the daemon remains unreachable, one worker auto-spawns a new one.
- Browser clients reconnect automatically.

---

## Slash command reference

All commands run inside openclaude:

| Command          | Effect                                                               |
| ---------------- | -------------------------------------------------------------------- |
| `/remote`        | Show current status (same as `/remote status`)                       |
| `/remote status` | Show status: URL, daemon connection, session count                   |
| `/remote on`     | Connect to daemon (auto-start if needed); register this session      |
| `/remote off`    | Disconnect this worker from the daemon                               |
| `/remote rotate` | Generate a fresh bearer token and persist it (reconnects if on)      |

---

## Configuration

The daemon reads config from the same global settings file the rest of
openclaude uses: `~/.claude/settings.json`. Add a `localRemote` section:

```jsonc
{
  "localRemote": {
    "port": 7842,          // default
    "host": "127.0.0.1",   // default (localhost only)
    "token": "...",        // auto-generated on first /remote on
    "autoStart": false     // reserved for future use
  }
}
```

All fields are optional. Defaults: port `7842`, host `127.0.0.1`, token
generated with 32 random bytes on first start, autoStart off.

### Exposing the server

By default the daemon binds to `127.0.0.1`. To expose on LAN or via
tunnel, set `host: "0.0.0.0"`:

```jsonc
{
  "localRemote": {
    "host": "0.0.0.0",
    "port": 7842
  }
}
```

---

## REST API

### `GET /healthz` (no auth)

```json
{ "ok": true, "role": "daemon", "sessions": 2 }
```

Used by workers to probe whether the daemon is alive.

### `GET /api/sessions` (Bearer token required)

```json
[
  {
    "id": "a1b2c3...",
    "cwd": "/home/user/project",
    "pid": 12345,
    "title": "openclaude @ /home/user/project",
    "startedAt": 1713200000000,
    "isLoading": false,
    "hasPendingPermission": true
  }
]
```

---

## Authentication

The daemon uses a single **bearer token** stored in `localRemote.token`.
All endpoints (except `/healthz` and static assets) require it:

1. **HTTP `Authorization: Bearer <token>` header** — for REST and scripted
   clients.
2. **WebSocket `?token=<token>` query parameter** — for browsers.

### Rotating the token

```text
/remote rotate
```

The worker disconnects, rotates the token in config, and reconnects with
the new token. Other workers and clients must also reconnect (they are
kicked with close code `4001`).

---

## Wire protocol

Everything is JSON over WebSocket. See `src/localRemote/types.ts` for
authoritative type definitions.

### Daemon ↔ Browser (`/ws/client`)

**Server → client:**

| type              | payload                                    | when                                           |
| ----------------- | ------------------------------------------ | ---------------------------------------------- |
| `hello`           | `{sessionId, cwd, serverVersion}`          | after selecting a session                      |
| `snapshot`        | `{messages: Message[]}`                    | on session select / reconnect                  |
| `messages`        | `{messages: Message[]}`                    | on every change to the conversation            |
| `permission_req`  | `{request: {...}}`                         | tool is asking for approval                    |
| `permission_clear`| `{requestId}`                              | a pending request was resolved                 |
| `status`          | `{isLoading: boolean}`                     | model is thinking / finished                   |
| `sessions`        | `{sessions: SessionSummary[]}`             | on connect and whenever sessions change        |
| `session_gone`    | `{sessionId}`                              | selected session disconnected                  |
| `error`           | `{message: string}`                        | server-side issue                              |

**Client → server:**

| type                 | payload                                                    | effect                                       |
| -------------------- | ---------------------------------------------------------- | -------------------------------------------- |
| `prompt`             | `{text: string}`                                           | enqueues the text as a user prompt           |
| `permission_response`| `{requestId, behavior, message?}`                          | resolves the matching permission prompt      |
| `select_session`     | `{sessionId}`                                              | switch subscription to a different session   |
| `ping`               | `{}`                                                       | keepalive                                    |

### Worker ↔ Daemon (`/ws/worker`)

**Worker → daemon:**

| type              | payload                                                      |
| ----------------- | ------------------------------------------------------------ |
| `register`        | `{sessionId, cwd, pid, title, startedAt, serverVersion}`    |
| `messages`        | `{messages: Message[]}`                                      |
| `status`          | `{isLoading: boolean}`                                       |
| `permission_req`  | `{request: {...}}`                                           |
| `permission_clear`| `{requestId}`                                                |
| `error`           | `{message}`                                                  |
| `bye`             | `{reason?}`                                                  |

**Daemon → worker:**

| type                 | payload                                                    |
| -------------------- | ---------------------------------------------------------- |
| `hello`              | `{ok: true}`                                               |
| `prompt`             | `{text}`                                                   |
| `permission_response`| `{requestId, behavior, message?}`                          |
| `kick`               | `{code, reason}`                                           |

### Close codes

| Code | Meaning                                                         |
| ---- | --------------------------------------------------------------- |
| 1000 | Normal close                                                    |
| 4000 | Daemon stopping (`/remote off` or process exit)                 |
| 4001 | Superseded (duplicate session, token rotation)                  |
| 1006 | Abnormal closure (network drop, crash)                          |

---

## Using the PWA from a phone

The daemon serves a small Vue PWA at `GET /`. It connects to the daemon,
shows a session list, and lets you pick any session to interact with.

### Same-LAN (home network)

1. Set `"host": "0.0.0.0"` in settings, ensure daemon is running.
2. Open `http://<host-ip>:7842/` on phone.
3. Paste token, connect, pick a session.
4. Add to Home Screen for standalone mode.

### Over the internet — SSH tunnel

```bash
ssh -L 7842:localhost:7842 user@your-pc
```

### Over the internet — Cloudflare Tunnel

```bash
cloudflared tunnel --url http://localhost:7842
```

---

## Security notes

- The daemon binds `127.0.0.1` by default.
- Only one bearer token gates all access. Treat it like a password.
- Tokens are 32 bytes from `crypto.randomBytes` (≈256 bits entropy).
- Token compare uses constant-time comparison.
- Static assets are served without token (they're generic, no session data).
- PID file uses atomic `O_CREAT | O_EXCL` to prevent races.

### Threat model

Designed for:
- A developer running openclaude on their PC, wanting to control
  multiple sessions from their phone over home LAN or a tunnel.

Not designed for:
- Multi-tenant servers (no user/RBAC system).
- Untrusted networks without TLS.

---

## Key files

- `src/localRemote/daemon/daemonServer.ts` — daemon HTTP + WS server
- `src/localRemote/daemon/sessionRouter.ts` — in-memory session registry
- `src/localRemote/daemon/main.ts` — daemon entry / CLI
- `src/localRemote/daemon/autoSpawn.ts` — auto-spawn logic
- `src/localRemote/daemon/pidLock.ts` — PID file locking
- `src/localRemote/workerConnection.ts` — worker WS client to daemon
- `src/localRemote/index.ts` — public API (startLocalRemote, etc.)
- `src/localRemote/types.ts` — wire protocol types
- `src/commands/remote.ts` — `/remote` slash command
- `clients/vue-remote/` — Vue PWA client

The cloud bridge under `src/bridge/` is untouched.
