# Derived Runtime Architecture

## Vision
A local-first intelligent terminal that prioritizes project analysis and local pipelines while maintaining optional AI support.

## Conceptual Layers

### 1. Legacy Core (Upstream)
- **Runtime**: Bun + Ink for the CLI experience.
- **Command System**: Commander.js based registration.
- **Telemetry**: (To be evaluated/disabled in later phases).

### 2. Future Engine Layer (The "Brain")
- Local analysis tools (Trivy, Semgrep integration).
- Project structure validation.
- Technical reporting engine.

### 3. External Integrations
- Optional LLM support via existing providers.
- Local model support (Ollama).

## Phase 1 Strategy: "The Chasis First"
In this phase, we preserve 99% of the upstream core. We are simply "registering" our presence and testing the extension points.

### What is preserved?
- All existing commands.
- All provider integrations.
- Build system.

### What is extended?
- A new command `/analyze-project` serves as the entry point for our future engine.

### What is NOT touched?
- Core sandboxing.
- Authentication flows.
- Protocol handlers.
