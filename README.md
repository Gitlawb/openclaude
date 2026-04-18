# OzyAudit

> Local-first audit terminal for project analysis, security scanning, and explainable scoring.

OzyAudit is a local-first CLI designed to inspect software projects, run security scans, generate technical reports, and produce an explainable health score.

It evolved into a modular audit platform with:

- structural project analysis
- SAST scanning with Semgrep
- SCA scanning with Trivy
- Markdown and JSON reporting
- automated local pipeline execution
- deterministic and explainable scoring

---

## Features

- **Project Analysis**
  - detects project type
  - inspects key files and directories
  - validates basic project structure

- **Security Scanning**
  - **Semgrep** for code/security patterns (SAST)
  - **Trivy** for dependency and filesystem vulnerabilities (SCA)

- **Technical Reporting**
  - generates professional **Markdown** reports
  - exports machine-readable **JSON** reports

- **Pipeline Execution**
  - runs a complete local audit flow
  - produces a final score and status:
    - PASS
    - WARN
    - FAIL

- **Explainable Scoring**
  - no black box logic
  - every penalty is traceable and understandable

---

## Architecture

OzyAudit is organized as a modular CLI platform:

```text
src/
  commands/         # thin CLI commands
  engine/
    project/        # project analysis
    security/       # Semgrep + Trivy integration
    report/         # report building and export
    pipeline/       # orchestration
    score/          # deterministic scoring
```

### Design principles

* thin commands
* reusable engines
* deterministic outputs
* graceful degradation when tools are missing
* local-first execution

---

## Main Commands

### Analyze project

```bash
/analyze-project
```

Detects project type, package manager, key files, and basic structural findings.

### Scan security

```bash
/scan-security
```

Runs security analysis using available engines:

* Semgrep
* Trivy

### Generate report

```bash
/generate-report
```

Creates:

* Markdown report
* JSON report

### Run full pipeline

```bash
/run-pipeline
```

Executes the complete audit flow and returns:

* score
* grade
* explanation
* report artifacts

---

## Example Output

```text
Pipeline Execution Report
-------------------------
Score: 72 / 100
Status: WARN

Project:
- Type: node
- Tests: ✅
- CI: ❌
- Docker: ✅

Security:
- Findings: 2
- High: 1
- Medium: 1

Explanation:
- High severity issues (1) contributed major penalties.
- Medium vulnerabilities (1) contributed moderate penalties.
- No CI pipeline detected, impacting continuous validation score (-8).
```

---

## Reports

Generated reports are stored in:

```text
reports/
```

Formats:

* `audit-report-YYYY-MM-DD_HH-MM-SS.md`
* `audit-report-YYYY-MM-DD_HH-MM-SS.json`

---

## Requirements

* Bun
* Node.js
* ripgrep
* git

Optional but recommended:

* Semgrep
* Trivy

---

## Install Dependencies

### Core

```bash
bun install
```

### Semgrep

Install from the official Semgrep documentation.

### Trivy

Install from the official Trivy documentation.

---

## Development

Build:

```bash
bun run build
```

Run:

```bash
bun run dev
```

---

## Project Vision

OzyAudit is not just a CLI wrapper.

It is a **local-first technical audit system** designed to:

* inspect software projects
* detect structural weaknesses
* identify security issues
* generate professional audit artifacts
* provide an explainable engineering score

---

## Current Scope

Implemented:

* project analysis
* Semgrep integration
* Trivy integration
* reporting engine
* unified pipeline
* deterministic score engine

Planned next phases:

* configurable scoring via `.auditrc`
* severity filters
* CI integration
* richer report views

---

## License

MIT
