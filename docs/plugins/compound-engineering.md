# Compound Engineering Plugin

Compound Engineering can run as a native OpenClaude plugin through the existing marketplace, plugin, skill, and agent loaders. No generated command files or converter output are required for OpenClaude to load its `skills/` and `agents/` directories.

## Install

Add the marketplace, then install the plugin:

```bash
openclaude plugin marketplace add https://github.com/LLMpsycho/compound-engineering-plugin --sparse .claude-plugin plugins
openclaude plugin install compound-engineering@compound-engineering-plugin
```

For a repo-local install, add `--scope local` to both commands.

If OpenClaude is already running, reload plugin state inside the session:

```text
/reload-plugins
```

## Commands

OpenClaude keeps the namespaced plugin command as the canonical identity:

```text
/compound-engineering:ce-plan
/compound-engineering:ce-work
/compound-engineering:lfg
```

Plugins that set `directSkillAliases: true` in `.claude-plugin/plugin.json` can also expose direct aliases from each skill's `name` or `aliases` frontmatter:

```text
/ce-plan
/ce-work
/lfg
```

Direct aliases are skipped when they collide with an existing command name or alias. The canonical namespaced command remains available even when a direct alias is skipped.

## Agents

Compound Engineering agents in `agents/*.agent.md` load through the normal plugin agent path and appear with plugin namespaced agent types such as:

```text
compound-engineering:ce-repo-research-analyst
```

Plugin agents may declare descriptive metadata such as `description`, `model`, `tools`, and `color`. Per-agent `permissionMode`, `hooks`, and `mcpServers` remain ignored for marketplace safety. Plugin-level hooks and MCP servers must be declared at the plugin manifest boundary instead.

## Verify

Use these checks after install or update:

```bash
openclaude plugin list
openclaude plugin validate /path/to/compound-engineering-plugin/plugins/compound-engineering/.claude-plugin/plugin.json
```

In an OpenClaude session, open slash command autocomplete and check for the namespaced commands. If the installed plugin manifest opts into direct aliases, also check `/ce-plan`, `/ce-work`, and `/lfg`.
