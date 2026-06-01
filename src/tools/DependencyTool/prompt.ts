import { DEPENDENCY_TOOL_NAME } from './constants.js'

export function getDescription(): string {
  return `A tool for analyzing project dependencies.

  Usage:
  - Use ${DEPENDENCY_TOOL_NAME} to audit, analyze, and inspect project dependencies.
  - Operations:
    - "audit": Run security audit (npm audit, cargo audit, pip-audit, etc.).
    - "outdated": Check for outdated packages.
    - "graph": Show dependency tree/relationships.
    - "license": List dependency licenses.
    - "info": Show details for a specific package.
  - Auto-detects package manager from project files.
  - Results are structured for easy reasoning about dependency health.
`
}
