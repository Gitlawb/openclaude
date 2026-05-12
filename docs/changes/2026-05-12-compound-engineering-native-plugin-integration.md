# Compound Engineering Native Plugin Integration

Date: 2026-05-12

## Summary

OpenClaude now has a tested native path for Compound Engineering shaped plugins. The plugin loader recognizes metadata-only manifests with default `skills/` and `agents/` directories, plugin skills keep their namespaced canonical command names, and plugins can opt into direct slash command aliases with `directSkillAliases: true`.

## Files Changed

- `src/utils/plugins/schemas.ts`
- `src/utils/plugins/loadPluginCommands.ts`
- `src/utils/plugins/pluginSkillAliases.ts`
- `src/utils/plugins/pluginSkillAliases.test.ts`
- `src/utils/plugins/pluginAliasCollisions.ts`
- `src/utils/plugins/pluginAliasCollisions.test.ts`
- `src/commands.ts`
- `src/utils/frontmatterParser.ts`
- `src/utils/plugins/pluginLoaderCompound.test.ts`
- `src/utils/plugins/loadPluginCommands.test.ts`
- `src/tools/AgentTool/loadAgentsDir.test.ts`
- `tests/plugin-compound-engineering-smoke.test.ts`
- `tests/fixtures/plugins/compound-engineering/**`
- `docs/plugins/compound-engineering.md`

## Why

Compound Engineering expects commands such as `/ce-plan`, `/ce-work`, and `/lfg`, while OpenClaude's plugin safety model uses namespaced canonical command names such as `/compound-engineering:ce-plan`. This change preserves namespacing as the default and adds direct aliases only through explicit plugin opt-in.

## Verification

- `bun test src/utils/plugins/pluginLoaderCompound.test.ts src/utils/plugins/loadPluginCommands.test.ts src/utils/plugins/pluginSkillAliases.test.ts src/utils/plugins/pluginAliasCollisions.test.ts src/tools/AgentTool/loadAgentsDir.test.ts tests/plugin-compound-engineering-smoke.test.ts`
- `bun run build`
- `/Users/besi/.agents/bin/semgrep-gate scan --profile stop <changed paths>`
- `sentrux gate .`
- `bun run typecheck` was attempted. The repo still has broad pre-existing typecheck failures unrelated to this change; a filtered pass for the changed surfaces returned no errors.
- Browser test applicability was checked with `agent-browser` installed, but no browser route was exercised because this change only touches CLI/plugin loader behavior, tests, fixtures, and docs.

## Follow-Ups

- The Compound Engineering plugin manifest must set `directSkillAliases: true` before installed CE builds expose `/ce-plan`, `/ce-work`, and `/lfg` as direct aliases.
