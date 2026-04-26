# OpenClaude Local Agent Playbook

This playbook is a practical guide to run OpenClaude with a local model (Ollama), work safely, and get strong day-to-day results.

## 1. What You Have

- A CLI agent loop that can read/write files, run terminal commands, and help with coding workflows.
- A local provider profile system (`profile:init` and `dev:profile`).
- Runtime checks (`doctor:runtime`) and reporting (`doctor:report`).
- A local model profile currently set to `llama3.1:8b`.

## 2. Daily Start (Fast Path)

Run this in your project root:

```powershell
bun run dev:profile
```

For quick switches:

```powershell
# low latency preset
bun run dev:fast

# better coding quality preset
bun run dev:code
```

If everything is healthy, OpenClaude starts directly.

## 3. One-Time Setup (If Needed)

### 3.1 Initialize a local profile

```powershell
bun run profile:init -- --provider ollama --model llama3.1:8b
```

Or let OpenClaude recommend the best local model for your goal:

```powershell
bun run profile:init -- --provider ollama --goal coding
```

Preview recommendations before saving:

```powershell
bun run profile:recommend -- --goal coding --benchmark
```

### 3.2 Confirm profile file

```powershell
Get-Content .\.openclaude-profile.json
```

### 3.3 Validate environment

```powershell
bun run doctor:runtime
```

## 4. Health and Diagnostics

### 4.1 Human-readable checks

```powershell
bun run doctor:runtime
```

### 4.2 JSON diagnostics (automation/logging)

```powershell
bun run doctor:runtime:json
```

### 4.3 Persist runtime report

```powershell
bun run doctor:report
```

Report output:

- `reports/doctor-runtime.json`

### 4.4 Hardening checks

```powershell
# practical checks (smoke + runtime doctor)
bun run hardening:check

# strict checks (includes typecheck)
bun run hardening:strict
```

## 5. Provider Modes

## 5.1 Local mode (Ollama)

```powershell
bun run profile:init -- --provider ollama --model llama3.1:8b
bun run dev:profile
```

Expected behavior:

- No API key required.
- `OPENAI_BASE_URL` should be `http://localhost:11434/v1`.

## 5.2 OpenAI mode

```powershell
bun run profile:init -- --provider openai --api-key sk-... --model gpt-4o
bun run dev:profile
```

Expected behavior:

- Real API key required.
- Placeholder values fail fast.

## 6. Troubleshooting Matrix

## 6.1 `Script not found "dev"`

Cause:

- You ran command in the wrong folder.

Fix:

```powershell
cd <PATH>
bun run dev:profile
```

## 6.2 `ollama: term not recognized`

Cause:

- Ollama not installed or PATH not loaded in this terminal.

Fix:

- Install Ollama from https://ollama.com/download/windows or `winget install Ollama.Ollama`.
- Open a new terminal and run:

```powershell
ollama --version
```

## 6.3 `Provider reachability failed` for localhost

Cause:

- Ollama service not running.

Fix:

```powershell
ollama serve
```

Then, in another terminal:

```powershell
bun run doctor:runtime
```

## 6.4 `Missing key for non-local provider URL`

Cause:

- `OPENAI_BASE_URL` points to remote endpoint without key.

Fix:

- Re-initialize profile for ollama:

```powershell
bun run profile:init -- --provider ollama --model llama3.1:8b
```

Or pick a local Ollama profile automatically by goal:

```powershell
bun run profile:init -- --provider ollama --goal balanced
```

## 6.5 Placeholder key (`YOUR_KEY`) error

Cause:

- Placeholder was used instead of real key.

Fix:

- For OpenAI: use a real key.
- For Ollama: no key needed; keep localhost base URL.

## 7. Recommended Local Models

- Fast/general: `llama3.1:8b`
- Better coding quality (if hardware supports): `qwen2.5-coder:14b`
- Low-resource fallback: smaller instruct model

Switch model quickly:

```powershell
bun run profile:init -- --provider ollama --model qwen2.5-coder:14b
bun run dev:profile
```

Preset shortcuts already configured:

```powershell
bun run profile:fast   # llama3.2:3b
bun run profile:code   # qwen2.5-coder:7b
```

Goal-based local auto-selection:

```powershell
bun run profile:init -- --provider ollama --goal latency
bun run profile:init -- --provider ollama --goal balanced
bun run profile:init -- --provider ollama --goal coding
```

`profile:auto` is a best-available provider picker, not a local-only command. Use `--provider ollama` when you want to stay on a local model.

## 8. Practical Prompt Playbook (Copy/Paste)

## 8.1 Code understanding

- "Map this repository architecture and explain the execution flow from entrypoint to tool invocation."
- "Find the top 5 risky modules and explain why."

## 8.2 Refactoring

- "Refactor this module for clarity without behavior change, then run checks and summarize diff impact."
- "Extract shared logic from duplicated functions and add minimal tests."

## 8.3 Debugging

- "Reproduce the failure, identify root cause, implement fix, and validate with commands."
- "Trace this error path and list likely failure points with confidence levels."

## 8.4 Reliability

- "Add runtime guardrails and fail-fast messages for invalid provider env vars."
- "Create a diagnostic command that outputs JSON report for CI artifacts."

## 8.5 Review mode

- "Do a code review of unstaged changes, prioritize bugs/regressions, and suggest concrete patches."

## 9. Safe Working Rules

- Run `doctor:runtime` before debugging provider issues.
- Prefer `dev:profile` over manual env edits.
- Keep `.openclaude-profile.json` local (already gitignored).
- Use `doctor:report` before asking for help so you have a reproducible snapshot.

## 10. Quick Recovery Checklist

When something breaks, run in order:

```powershell
bun run doctor:runtime
bun run doctor:report
bun run smoke
```

If answers are very slow, check processor mode:

```powershell
ollama ps
```

If `PROCESSOR` shows `CPU`, your setup is valid but latency will be higher for large models.

If local model mode is failing:

```powershell
ollama --version
ollama serve
bun run doctor:runtime
bun run dev:profile
```

## 11. Command Reference

```powershell
# profile
bun run profile:init -- --provider ollama --model llama3.1:8b
bun run profile:init -- --provider openai --api-key sk-... --model gpt-4o

# launch
bun run dev:profile
bun run dev:ollama
bun run dev:openai

# diagnostics
bun run doctor:runtime
bun run doctor:runtime:json
bun run doctor:report

# quality
bun run smoke
bun run hardening:check
bun run hardening:strict
```

## 12. Success Criteria

Your setup is healthy when:

- `bun run doctor:runtime` passes provider and reachability checks.
- `bun run dev:profile` opens the CLI normally.
- Model shown in the UI matches your selected profile model.
