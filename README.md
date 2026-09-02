<div align="center">
  <img src="docs/assets/openclaude-wordmark.png" alt="OpenClaude — Open terminal for any LLM" width="830">


  <p>
    <a href="https://trendshift.io/repositories/25807?utm_source=trendshift-badge&amp;utm_medium=badge&amp;utm_campaign=badge-trendshift-25807" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/trendshift/repositories/25807/daily?language=TypeScript" alt="Gitlawb%2Fopenclaude | Trendshift" width="250" height="55"/></a>
    <a href="https://trendshift.io/repositories/25807?utm_source=trendshift-badge&amp;utm_medium=badge&amp;utm_campaign=badge-trendshift-25807" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/trendshift/repositories/25807/monthly?language=TypeScript" alt="Gitlawb%2Fopenclaude | Trendshift" width="250" height="55"/></a>
    <a href="https://trendshift.io/repositories/25807?utm_source=repository-badge&amp;utm_medium=badge&amp;utm_campaign=badge-repository-25807" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/repositories/25807" alt="Gitlawb%2Fopenclaude | Trendshift" width="250" height="55"/></a>
  </p>
</div>


OpenClaude is an open-source coding-agent CLI for cloud and local model providers.


Use OpenAI-compatible APIs, Gemini, GitHub Models, Codex OAuth, Codex, Ollama, Atomic Chat, and other supported backends while keeping one terminal-first workflow: prompts, tools, agents, MCP, slash commands, and streaming output.


[![PR Checks](https://github.com/Gitlawb/openclaude/actions/workflows/pr-checks.yml/badge.svg?branch=main)](https://github.com/Gitlawb/openclaude/actions/workflows/pr-checks.yml)
[![Release](https://img.shields.io/github/v/tag/Gitlawb/openclaude?label=release&color=0ea5e9)](https://github.com/Gitlawb/openclaude/tags)
[![npm downloads](https://img.shields.io/npm/dm/@gitlawb/openclaude)](https://www.npmjs.com/package/@gitlawb/openclaude)
[![Discussions](https://img.shields.io/badge/discussions-open-7c3aed)](https://github.com/Gitlawb/openclaude/discussions)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.gg/k68zFR6AcB)
[![X](https://img.shields.io/badge/X-@gitlawb-000000?logo=x&logoColor=white)](https://x.com/gitlawb)
[![Security Policy](https://img.shields.io/badge/security-policy-0f766e)](SECURITY.md)
[![License](https://img.shields.io/badge/license-MIT-2563eb)](LICENSE)


OpenClaude is also mirrored to GitLawb:
[gitlawb.com/node/repos/z6MkqDnb/openclaude](https://gitlawb.com/node/repos/z6MkqDnb/openclaude)


[Quick Start](#quick-start) | [Setup Guides](#setup-guides) | [Providers](#supported-providers) | [Development](#development) | [VS Code Extension](#vs-code-extension) | [Partners](#partners) | [Community](#community)

## Optional Parallel Search MCP

If your backend does not provide native web search, you can add [Parallel Search MCP](https://docs.parallel.ai/integrations/mcp/search-mcp) as a project-scoped remote MCP server. It does not require an API key for light, anonymous use, but anonymous access has lower limits and individual searches or fetches may fail.

Add this entry to .mcp.json in the project where you run OpenClaude (merge it with an existing mcpServers object rather than replacing other servers):

```json
{
  "mcpServers": {
    "parallel-search": {
      "type": "http",
      "url": "https://search.parallel.ai/mcp"
    }
  }
}
```

Start OpenClaude from that project and approve parallel-search when the project-scoped MCP server prompt appears. To check the configuration and make a live connection check, run:

```bash
openclaude mcp doctor parallel-search --scope project
```

Once connected, ask the model to use web_search to find relevant library documentation, then web_fetch to read a promising result. These are Parallel's MCP tools and are separate from OpenClaude's built-in WebSearch and WebFetch tools. For higher limits, see Parallel's documentation for authenticated setup.
