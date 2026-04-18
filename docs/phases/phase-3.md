# Phase 3: Security Engine (Semgrep Integration)

## Objective
Implement a real security scanning capability by integrating Semgrep into the Project Engine.

## Scope
- Creation of the Security Engine layer (`src/engine/security/`).
- Integration with Semgrep binary for static analysis.
- Implementation of `/scan-security` command.
- Normalized finding reporting with severity mapping.

## Technical Decisions
- **Decoupled Architecture**: Separate runner, parser, and aggregator to allow future multi-tool integration (e.g., Trivy, Gitleaks).
- **JSON-First Parsing**: Use `--json` output from Semgrep to ensure reliable and structured data extraction.
- **Graceful Error Handling**: Detect missing binary and provide installation instructions to the user.
- **Severity Mapping**:
  - ERROR -> HIGH
  - WARNING -> MEDIUM
  - INFO -> LOW

## How to install Semgrep
To use `/scan-security`, you need Semgrep installed on your system:
```bash
python3 -m pip install semgrep
# or
brew install semgrep
```

## Limitations
- Only supports Semgrep in this phase.
- Uses default `auto` config.
- No remediation suggestions yet.

## Usage
Type `/scan-security` in the terminal to run a scan on the current project.
