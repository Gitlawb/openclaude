---
name: local-handbook
description: >-
  Personal playbook (handbook v2, 2026-04). Before substantial edits, debugging,
  ambiguous scope, or multi-step work: read logic.md then memory.md. User’s
  explicit Cursor instructions override this skill when they conflict. Append
  memory.md when the user states a durable preference or corrects a mistake
  that should persist.
---

# Local handbook

Companion files turn generic model behavior into **repeatable, verifiable** work on this machine and in mirrored repos.

## Files

| File | Read for |
|------|-----------|
| `logic.md` | Reasoning, verification gates, safety, git/MCP habits. |
| `memory.md` | Facts that should survive across sessions (paths, remotes, prefs). |
| `config/` | Versioned **MCP** + **Cursor** settings snapshots; see `config/README.md`. |
| `scripts/apply-machine-config.sh` | Copies `config/mcp*.json` to `~/.claude` and refreshes `~/.cursor/mcp.json` symlink. |

## When this skill applies

- Implementing or refactoring **non-trivial** behavior.
- Debugging failures, flaky tests, or unclear stack traces.
- Touching **auth, payments, migrations, deploy**, or anything irreversible without an explicit green light.
- The user’s ask is **ambiguous** — clarify briefly, then proceed with stated assumptions.

## Boot checklist (do in order)

1. Skim **`memory.md`** for this scope (global vs repo section).
2. If the repo has **`AGENTS.md`**, **`CLAUDE.md`**, or **`SESSION.md`**, read the relevant one before large edits.
3. Choose the **narrowest** verify command that matches the change (see repo `memory.md` where listed).
4. After edits, **run** that command; report failures with evidence, not guesses.

## Progressive disclosure

- **Project rules win** over this handbook when they conflict.
- Prefer **existing patterns** in the codebase over new abstractions unless the task requires them.
- Use **MCP tools** when configured and they reduce ambiguity (docs, tickets, CI); handle tool errors without pretending success.

## Maintenance

- Keep `memory.md` **short** (bullets, not essays). Move long narratives to project `CLAUDE.md` / `AGENTS.md`.
- Keep `logic.md` about **process**, not secrets or one-off ticket dumps.
