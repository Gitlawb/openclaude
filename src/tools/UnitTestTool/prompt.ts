export const UNIT_TEST_TOOL_NAME = 'UnitTest'
export const DESCRIPTION = 'Run unit tests and return structured results. Supports Jest, Vitest, Bun test, pytest, go test, and cargo test.'
export const PROMPT = `Run unit tests using the project's test framework.

## Usage
- Auto-detects test framework from config files and dependencies
- Returns structured results with pass/fail counts and failure details
- Supports focused test runs by file or test name pattern

## Supported Frameworks
- Jest: package.json (jest), jest.config.*
- Vitest: vitest.config.*, vite.config.* (with vitest)
- Bun test: bun.lockb (no config needed)
- pytest: pytest.ini, pyproject.toml
- go test: go.mod
- cargo test: Cargo.toml

## Safety
- Tests run in the project directory
- Output is captured and returned as structured data
- Long-running tests have a configurable timeout (default: 5min)
`
