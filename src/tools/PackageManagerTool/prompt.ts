export const PACKAGE_MANAGER_TOOL_NAME = 'PackageManager'
export const DESCRIPTION = 'Manage project dependencies across package managers. Supports install, update, remove, list, audit, and outdated checks.'
export const PROMPT = `Manage project dependencies using the project's package manager.

## Usage
- Auto-detects package manager from project files (package.json, pyproject.toml, go.mod, Cargo.toml, bun.lockb)
- Supports install, update, remove, list, audit, and outdated operations
- Dry-run mode previews changes without applying them

## Supported Managers
- npm: package.json, package-lock.json
- pip: requirements.txt, pyproject.toml
- go: go.mod, go.sum
- cargo: Cargo.toml, Cargo.lock
- bun: bun.lockb
- brew: Formula (system-level)

## Safety
- Install/update/remove operations require explicit opt-in
- Dry-run mode (-n) is available to preview changes
- Audit checks for known vulnerabilities
- Package names are validated before execution
`
