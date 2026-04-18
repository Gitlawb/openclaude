# Phase 6: Local Pipeline & Score Engine

## Objective
Convert the individual analysis tools into a cohesive automated pipeline with an explainable health score and Quality Gates (PASS/WARN/FAIL).

## Scope
- Creation of the Pipeline Engine (`src/engine/pipeline/`).
- Implementation of the Score Engine (`src/engine/score/`).
- Automated orchestration of Project Analysis, Security Scanning, and Reporting.
- Rule-based explainable scoring system.
- Implementation of `/run-pipeline` command.

## Scoring Logic
The score starts at **100** and applies penalties based on findings:
### Security Penalties
- Critical: -40
- High: -20
- Medium: -8
- Low: -3

### Project Structure Penalties
- Missing Tests: -10
- Missing CI: -8
- Missing .gitignore: -10
- Missing .env.example: -3

## Classification (Quality Gates)
- **PASS**: Score >= 80
- **WARN**: Score >= 50
- **FAIL**: Score < 50

## Technical Decisions
- **Explainability First**: The system doesn't just provide a number; it generates an array of strings explaining the main factors impacting the score.
- **Atomic Pipeline**: The executor is responsible for collecting data from all sub-engines before the score calculation.
- **Fixed Sequence**: For now, the pipeline follows a predefined order to ensure data dependencies are met.

## Future Steps
- Configurable Quality Gates (via `config.json`).
- Trend analysis (comparing scores between runs).
- Slack/Webhook notifications for pipeline results.
