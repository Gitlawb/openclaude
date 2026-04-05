# OpenLawb VS Code Extension

A practical VS Code companion for OpenLawb with a project-aware **Control Center**, predictable terminal launch behavior, and quick access to useful OpenLawb workflows.

## Features

- **Real Control Center status** in the Activity Bar:
  - whether the configured `openlawb` command is installed
  - the launch command being used
  - whether the launch shim injects `CLAUDE_CODE_USE_OPENAI=1`
  - the current workspace folder
  - the launch cwd that will be used for terminal sessions
  - whether `.openlawb-profile.json` exists in the current workspace root
  - a conservative provider summary derived from the workspace profile or known environment flags
- **Project-aware launch behavior**:
  - `Launch OpenLawb` launches from the active editor's workspace when possible
  - falls back to the first workspace folder when needed
  - avoids launching from an arbitrary default cwd when a project is open
- **Practical sidebar actions**:
  - Launch OpenLawb
  - Launch in Workspace Root
  - Open Workspace Profile
  - Open Repository
  - Open Setup Guide
  - Open Command Palette
- **Built-in dark theme**: `OpenLawb Terminal Black`

## Requirements

- VS Code `1.95+`
- `openlawb` available in your terminal PATH (`npm install -g @gitlawb/openlawb`)

## Commands

- `OpenLawb: Open Control Center`
- `OpenLawb: Launch in Terminal`
- `OpenLawb: Launch in Workspace Root`
- `OpenLawb: Open Repository`
- `OpenLawb: Open Setup Guide`
- `OpenLawb: Open Workspace Profile`

## Settings

- `openlawb.launchCommand` (default: `openlawb`)
- `openlawb.terminalName` (default: `OpenLawb`)
- `openlawb.useOpenAIShim` (default: `false`)

`openlawb.useOpenAIShim` only injects `CLAUDE_CODE_USE_OPENAI=1` into terminals launched by the extension. It does not guess or configure a provider by itself.

## Notes on Status Detection

- Provider status prefers the real workspace `.openlawb-profile.json` file when present.
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

