# Phase 4: Trivy Integration (Filesystem & Dependency Scanning)

## Objective
Extend the Security Engine to support multi-source scanning by integrating Trivy for Software Composition Analysis (SCA) alongside Semgrep (SAST).

## Scope
- Implementation of Trivy Runner (`fs` mode).
- Implementation of Trivy Parser (SCA findings).
- Refactor of `SecurityAggregator` to handle multiple tools in parallel.
- Unified reporting in `/scan-security` command.

## Technical Decisions
- **Parallel Execution**: Uses `Promise.allSettled` to run all scanners concurrently without blocking each other.
- **Graceful Degradation**: The aggregator collects warnings for missing binaries instead of throwing, allowing the scan to continue with available tools.
- **Unified Schema**: Expanded `SecurityFinding` to include package-specific fields (`packageName`, `vulnerabilityId`, etc.) while maintaining compatibility with code findings.

## How to install Trivy
To enable dependency scanning, install Trivy on your system:
```bash
brew install aquasecurity/trivy/trivy
# or
curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/install.sh | sh -s -- -b /usr/local/bin
```

## Difference between Semgrep and Trivy in this system
- **Semgrep**: Analyzes your **source code** for security patterns and bugs (SAST).
- **Trivy**: Analyzes your **dependencies** (lockfiles) and environment for known CVEs (SCA).

## Future Steps
- Integrate `trivy image` for Docker container scanning.
- Add a global Security Score engine.
- Automated remediation suggestions.
