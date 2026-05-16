export const LINT_TOOL_NAME = 'Lint'
export const DESCRIPTION = 'Run linters and code formatters on project files. Supports ESLint, Prettier, Ruff, Biome, golangci-lint, and clippy.'
export const PROMPT = `Run linters and code formatters on project files.

## Usage
- Auto-detects linter config from project files (.eslintrc, .prettierrc, ruff.toml, biome.json, etc.)
- Runs linter and returns structured results with error/warning counts
- Supports auto-fix mode where the linter supports it

## Supported Tools
- ESLint (JavaScript/TypeScript): .eslintrc, eslint.config.js
- Prettier: .prettierrc, prettier.config.js
- Ruff (Python): ruff.toml, pyproject.toml
- Biome: biome.json
- golangci-lint: .golangci.yml
- Clippy (Rust): Cargo.toml

## Safety
- Auto-fix is opt-in via the fix parameter
- Lint check mode never modifies files
- Results show file:line:column for each finding
`
