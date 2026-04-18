# Repository Map - OpenClaude Derived

## Entry Points
- **Binary**: `bin/openclaude` - Node.js wrapper that checks for built `dist/cli.mjs`.
- **Source Entry**: `src/main.tsx` - Main application entry point. Initializes Commander.js, Telemetry, and the React/Ink runtime.
- **Build Script**: `scripts/build.ts` - Bun-based build script that bundles everything into `dist/cli.mjs`.

## Command System
- **Registry**: `src/commands.ts` - Centralizes all command imports and exports the `getCommands` function.
- **Pattern**: Commands are objects satisfying the `Command` interface (defined in `src/types/command.ts`).
- **Types**:
  - `local`: Standard text-based output.
  - `prompt`: Generates a prompt for the LLM.
  - `local-jsx`: Renders Ink components.
- **Convention**: Most commands live in `src/commands/[name]/index.ts`.

## Build Flow
1. `bun run build` executes `scripts/build.ts`.
2. `scripts/build.ts` uses `Bun.build` with specific macros and plugins.
3. Output is a single ESM file at `dist/cli.mjs`.

## UI Surfaces
- **Interactive REPL**: Managed via `Ink` in `src/replLauncher.js` and `src/components/App.tsx`.
- **Setup Screens**: Managed in `src/interactiveHelpers.ts` (e.g., trust dialog).

## Sensitive Subsystems (Do NOT touch in Phase 1)
- `src/services/api/`: Provider and model integration logic.
- `src/utils/auth.ts`: Authentication and credential management.
- `src/utils/managedEnv.js`: Environment and security sandboxing.

## Notes for Future Phases
- Phase 2 will involve adding real project analysis capabilities to `/analyze-project`.
- Consider abstracting the "Engine" layer for local-first operations.
