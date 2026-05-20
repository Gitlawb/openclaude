# OpenRAG Integration

OpenClaude can use OpenRAG as an external knowledge base through OpenRAG's MCP server.

## Quick Start

1. Open the control center:

   ```bash
   bun run control-center
   ```

2. In the OpenRAG section, click `Install / update OpenRAG`.
3. Start OpenRAG either with `Start OpenRAG TUI` or `Start OpenRAG Docker`.
4. Open `http://localhost:3000`, or click `Create API key + MCP` in the control center.
5. Enable `Expose OpenRAG as MCP`, then click `Configure MCP` if you changed the MCP fields manually.

The default MCP server added to `.mcp.json` runs OpenClaude's local bridge:

```json
{
  "command": "node",
  "args": ["scripts/release/openrag-mcp-bridge.cjs"]
}
```

with `OPENRAG_URL`, `OPENRAG_API_KEY`, and `OPENRAG_MCP_TIMEOUT` supplied from the saved settings.

The bridge exposes stable tools for the agent:

- `openrag_search`: retrieve grounded chunks from the OpenRAG index.
- `openrag_ingest_file`: add a local file to the OpenRAG index.
- `openrag_chat`: try the upstream OpenRAG chat endpoint and fall back to retrieval if that endpoint is unavailable.
- `openrag_get_settings`, `openrag_update_settings`, `openrag_list_models`: inspect and tune OpenRAG from the agent.

For local Docker, Ollama works well with:

- LLM provider: `ollama`
- LLM model: `lfm2.5-1.2b-instruct`
- Embedding provider: `ollama`
- Embedding model: `nomic-embed-text:latest`
- Ollama endpoint from containers: `http://host.docker.internal:11434`

OpenRAG's current upstream Langflow chat/ingest flows can be version-sensitive. OpenClaude defaults file ingestion to OpenRAG's backend indexing API and makes the agent answer from `openrag_search` results, which is the stable path tested here.

The bridge is Docker-aware: if `OPENRAG_URL=http://localhost:3000` cannot be reached from a container, it retries the same port through `http://host.docker.internal:3000`. This keeps one `.mcp.json` usable on the host and in the Docker agent.

## Launch Scripts

Windows:

```bat
scripts\release\install-openrag.bat
scripts\release\start-openrag.bat
scripts\release\openrag-docker-up.bat
scripts\release\openrag-docker-down.bat
```

macOS/Linux:

```bash
scripts/release/install-openrag.sh
scripts/release/start-openrag.sh
scripts/release/openrag-docker-up.sh
scripts/release/openrag-docker-down.sh
```

On Windows, OpenRAG officially expects WSL. The `.bat` launchers use WSL when it is available.
