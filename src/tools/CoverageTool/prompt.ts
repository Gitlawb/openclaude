export const COVERAGE_TOOL_NAME = 'Coverage'
export const DESCRIPTION = 'Read and analyze lcov coverage reports. Returns line/branch percentages, per-file breakdown, and uncovered files list.'
export const PROMPT = `Read and analyze code coverage reports.

## Usage
- Reads existing lcov coverage report files (coverage/lcov.info)
- Returns structured coverage data with line/branch percentages
- Identifies uncovered files and optionally checks against a threshold
- Only lcov format is currently supported

## Safety
- Read-only operation: never modifies files
`
