export const COVERAGE_TOOL_NAME = 'Coverage'
export const DESCRIPTION = 'Generate and analyze code coverage reports. Supports lcov, cobertura, and clover formats.'
export const PROMPT = `Generate and analyze code coverage reports.

## Usage
- Reads existing coverage report files or runs tests with coverage
- Returns structured coverage data with line/branch/function percentages
- Identifies uncovered files and code sections

## Supported Formats
- lcov: coverage/lcov.info (JS/TS via Istanbul, Bun)
- cobertura: coverage/cobertura.xml (Python via pytest-cov)
- clover: coverage/clover.xml (Java via Clover)

## Safety
- Read-only operation: never modifies files
- Can optionally run tests to generate fresh coverage data
`
