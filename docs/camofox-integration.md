# Camofox Browser Integration

OpenClaude can use `jo-inc/camofox-browser` as a stealth browser through a
small local MCP bridge.

## Quick Start

Windows:

```bat
scripts\release\install-camofox.bat
scripts\release\start-camofox.bat
```

macOS/Linux:

```bash
scripts/release/install-camofox.sh
scripts/release/start-camofox.sh
```

The browser server runs at `http://localhost:9377`. The first install/start can
download the Camoufox browser binary.

## MCP

The project `.mcp.json` includes:

```json
{
  "command": "node",
  "args": ["scripts/release/camofox-mcp-bridge.cjs"]
}
```

The bridge exposes:

- `camofox_health`
- `camofox_create_tab`
- `camofox_list_tabs`
- `camofox_navigate`
- `camofox_snapshot`
- `camofox_click`
- `camofox_type`
- `camofox_press`
- `camofox_scroll`
- `camofox_screenshot`
- `camofox_close_tab`

Use `camofox_create_tab`, then `camofox_snapshot`, then interact with stable
element refs.

## Environment

Optional settings:

```bash
CAMOFOX_URL=http://localhost:9377
CAMOFOX_PORT=9377
CAMOFOX_ACCESS_KEY=
CAMOFOX_API_KEY=
CAMOFOX_MCP_USER_ID=openclaude-agent
CAMOFOX_MCP_SESSION_KEY=default
CAMOFOX_MCP_TIMEOUT=60
```

`CAMOFOX_ACCESS_KEY` gates normal routes when the Camofox server is configured
with `CAMOFOX_ACCESS_KEY`. `CAMOFOX_API_KEY` is also used for sensitive routes.

## Smoke Test

After starting Camofox:

```bash
bun run release:camofox:test
```

The test opens `https://example.com`, reads a snapshot, and closes the tab.
