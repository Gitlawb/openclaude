# @openclaude/vue-remote

A Vue 3 + Vite PWA client for openclaude's [`/remote`](../../docs/remote-session.md) bridge.

Bundled openclaude ships a minimal vanilla-JS client at `dist/client/`. This
project is a nicer, more feature-complete web client intended to be hosted
separately (or served by any static host) and pointed at a running
`/remote` server.

## Highlights

- **Vue 3 `<script setup>` + TypeScript** — strict types, single-file
  components, no framework-beyond-Vue.
- **Streamed messages** — user, assistant, tool_use (expandable), tool_result,
  images.
- **Remote tool approvals** — pending `PermissionRequest` appears as a
  prominent banner with Allow / Deny.
- **Auto-reconnect** — exponential backoff (1s → 20s) when the network
  drops, with a clear reconnecting state.
- **Persistent credentials** — URL and token saved to `localStorage`, so
  tapping an Add-to-Home-Screen app opens straight into the last session.
- **PWA-ready** — manifest + theme colour + safe-area-aware layout.
  Works great when installed to the iOS / Android home screen.
- **Mobile-first** — layout tuned for one-hand use on a phone; scales
  cleanly to desktop.

## Requirements

- Node 20 or newer, or Bun.
- A running openclaude session with `/remote on`.

## Quick start

```bash
cd clients/vue-remote
npm install
npm run dev
```

Open the printed URL, paste your `/remote on` token, and you're connected.

## Build & deploy

```bash
npm run build
# → dist/ contains a static site you can serve from anywhere
```

Deploy `dist/` to:

- **GitHub Pages / Cloudflare Pages / Netlify / Vercel** — drop-in, no config.
- **Your own reverse proxy** — any static file server works.
- **Same host as openclaude** — if you want to skip CORS concerns, put
  `dist/` behind a path on your reverse proxy next to the openclaude
  `/remote` server.

## Configuration

There is no build-time config — URL and token are entered at runtime.

Credentials are stored in `localStorage` under:

- `openclaude.remote.url`
- `openclaude.remote.token`

Clearing browser storage (or the in-app Settings button) forgets them.

## Scripts

| script            | purpose                                  |
| ----------------- | ---------------------------------------- |
| `npm run dev`     | Vite dev server on `:5173` with HMR      |
| `npm run build`   | Type-check (`vue-tsc`) + production build |
| `npm run preview` | Serve `dist/` locally for smoke testing  |
| `npm run typecheck` | `vue-tsc --noEmit`                     |

## Project structure

```
src/
  main.ts                       — app bootstrap
  App.vue                       — shell: StatusBar + (ConnectPanel | stream UI)
  types.ts                      — wire protocol (mirrors src/localRemote/types.ts)
  composables/
    useRemoteSession.ts         — WebSocket state machine (connect, reconnect, send)
    useStorage.ts               — localStorage-backed Vue ref
    renderMessage.ts            — WireMessage → displayable blocks
  components/
    StatusBar.vue               — top bar: status dot, cwd, settings button
    ConnectPanel.vue            — URL + token form
    MessageList.vue             — scrollable message stream with jump-to-latest
    Message.vue                 — one message, expandable tool_use / tool_result
    PermissionBanner.vue        — Allow / Deny banner for pending prompts
    PromptComposer.vue          — autosize textarea + send button
  styles/
    main.css                    — design tokens + resets + mobile polish
public/
  manifest.webmanifest
  favicon.svg
```

## Wire protocol

See the protocol reference in [docs/remote-session.md](../../docs/remote-session.md#wire-protocol).
Types are duplicated in `src/types.ts` so this client can ship independently
of the openclaude source tree.

## Differences from the bundled PWA

The vanilla-JS client in `dist/client/` (built from `src/localRemote/client/`)
is shipped alongside openclaude so you can connect without deploying anything
extra. It is intentionally tiny (~10 KB).

This Vue client is larger (~60 KB gzipped), adds:

- Proper tool call / result expansion
- Auto-reconnect with backoff
- Responsive layout polish
- Clean installable PWA behaviour

Use whichever fits — both speak the same protocol.
