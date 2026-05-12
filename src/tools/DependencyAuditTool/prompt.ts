export const DEPENDENCY_AUDIT_TOOL_NAME = 'DependencyAudit'
export const DESCRIPTION = 'Scan project dependencies for known vulnerabilities (CVEs). Supports npm audit, pip-audit, cargo audit, go vulncheck, and bun audit.'
export const PROMPT = `Scan project dependencies for known security vulnerabilities.

## Usage
- Auto-detects package manager from project files
- Runs security audit and returns structured results
- Shows severity levels: critical, high, medium, low
- Filters by minimum severity level

## Supported Managers
- npm: npm audit
- pip: pip-audit
- cargo: cargo-audit (cargo install cargo-audit)
- go: govulncheck
- bun: bun audit

## Safety
- Read-only: never modifies packages
- Results show advisory details and patched versions
- Severity filtering reduces noise
`
