# Hindsight Memory Integration

OpenClaude can use Hindsight as durable agent memory through a lightweight MCP
bridge. Hindsight remains a separate local service; OpenClaude talks to it over
HTTP and exposes memory tools to child agent runs.

## What It Is For

- `hindsight_retain`: store durable user, project, and agent memories.
- `hindsight_recall`: retrieve memories before answering questions about prior
  context, preferences, decisions, or learned behavior.
- `hindsight_reflect`: synthesize deeper observations from retained memories.
- `hindsight_consolidate`: queue Hindsight consolidation for the active bank.

Use Hindsight for long-term memory. Use OpenRAG for document-grounded retrieval.
Use Camofox for live browser automation.

## Quick Start

Run Hindsight with Docker:

```bash
bun run release:hindsight:docker:up
```

Or use the wrappers:

```bash
scripts/release/hindsight-docker-up.sh
scripts\release\hindsight-docker-up.bat
```

Default endpoints:

- API: `http://localhost:8888`
- UI: `http://localhost:9999`
- OpenClaude Docker target: `http://host.docker.internal:8888`

## Environment

```bash
HINDSIGHT_URL=http://localhost:8888
HINDSIGHT_API_KEY=
HINDSIGHT_BANK_ID=openclaude-agent
HINDSIGHT_MCP_TIMEOUT=60

HINDSIGHT_API_PORT=8888
HINDSIGHT_UI_PORT=9999
HINDSIGHT_API_LLM_PROVIDER=openai
HINDSIGHT_API_LLM_API_KEY=
HINDSIGHT_API_LLM_MODEL=
HINDSIGHT_API_LLM_BASE_URL=
OPENCLAUDE_DOCKER_HINDSIGHT_URL=http://host.docker.internal:8888
```

`HINDSIGHT_API_LLM_API_KEY` is used by Hindsight itself when started with
`hindsight-control.mjs docker-up`. `HINDSIGHT_API_KEY` is optional bridge auth
for Hindsight deployments that require a bearer token.

## MCP

The project `.mcp.json` includes:

```json
{
  "hindsight": {
    "command": "node",
    "args": ["scripts/release/hindsight-mcp-bridge.cjs"],
    "env": {
      "HINDSIGHT_URL": "http://localhost:8888",
      "HINDSIGHT_BANK_ID": "openclaude-agent",
      "HINDSIGHT_MCP_TIMEOUT": "60",
      "HINDSIGHT_API_KEY": "${HINDSIGHT_API_KEY}"
    }
  }
}
```

The bridge is Docker-aware: if `localhost` cannot be reached from a container,
it also tries `host.docker.internal`.

## Tests

Syntax and MCP smoke test:

```bash
node --check scripts/release/hindsight-mcp-bridge.cjs
node --check scripts/release/hindsight-control.mjs
bun run test:hindsight:mcp
```

Live Hindsight API smoke test:

```bash
bun run release:hindsight:test
```
