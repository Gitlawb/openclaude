# OpenClaude VS Code Extension

A practical VS Code companion for OpenClaude with a project-aware **Control Center**, predictable terminal launch behavior, and quick access to useful OpenClaude workflows.

## Features

- **Real Control Center status** in the Activity Bar:
  - whether the configured `openclaude` command is installed
  - the launch command being used
  - whether the launch shim injects `CLAUDE_CODE_USE_OPENAI=1`
  - the current workspace folder
  - the launch cwd that will be used for terminal sessions
  - whether `.openlawb-profile.json` exists in the current workspace root (legacy `.openclaude-profile.json` still works)
  - a conservative provider summary derived from the workspace profile or known environment flags
- **Project-aware launch behavior**:
  - `Launch OpenClaude` launches from the active editor's workspace when possible
  - falls back to the first workspace folder when needed
  - avoids launching from an arbitrary default cwd when a project is open
- **Practical sidebar actions**:
  - Launch OpenClaude
  - Launch in Workspace Root
  - Open Workspace Profile
  - Open Repository
  - Open Setup Guide
  - Open Command Palette
- **Built-in dark theme**: `OpenClaude Terminal Black`

## Requirements

- VS Code `1.95+`
- `openclaude` available in your terminal PATH (`npm install -g @gitlawb/openclaude`)

## Commands

- `OpenClaude: Open Control Center`
- `OpenClaude: Launch in Terminal`
- `OpenClaude: Launch in Workspace Root`
- `OpenClaude: Open Repository`
- `OpenClaude: Open Setup Guide`
- `OpenClaude: Open Workspace Profile`

## Settings

- `openclaude.launchCommand` (default: `openclaude`)
- `openclaude.terminalName` (default: `OpenClaude`)
- `openclaude.useOpenAIShim` (default: `false`)

`openclaude.useOpenAIShim` only injects `CLAUDE_CODE_USE_OPENAI=1` into terminals launched by the extension. It does not guess or configure a provider by itself.

## Notes on Status Detection

- Provider status prefers the real workspace `.openlawb-profile.json` file when present (with fallback to legacy `.openclaude-profile.json`).
- If no saved profile exists, the extension falls back to known environment flags available to the VS Code extension host.
- If the source of truth is unclear, the extension shows `unknown` instead of guessing.

## Development

From this folder:

```bash
npm run test
npm run lint
```

To package (optional):

```bash
npm run package
```
