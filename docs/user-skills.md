# User-Level Skills

Skills you place in `~/.openclaude/skills/` are available in **every project**, regardless of which directory you open.

This is useful for personal workflows — commit rituals, session wrap-ups, bug-hunt flows — that you want available everywhere without copying files into each repo.

## Where to put them

| Location | Scope |
|----------|-------|
| `<project>/.claude/skills/` | Current project only |
| `~/.openclaude/skills/` | All projects (default for new installs) |
| `~/.claude/skills/` | All projects (legacy installs only — see below) |

OpenClaude uses `~/.openclaude/` by default. It falls back to `~/.claude/` only when `~/.openclaude` does not exist and `~/.claude` already does (legacy installs). You can also override either path by setting `CLAUDE_CONFIG_DIR`. Run this to confirm which one applies to you:

```bash
# macOS / Linux
ls ~/.openclaude/skills/ 2>/dev/null || ls ~/.claude/skills/ 2>/dev/null || echo "neither exists yet"

# Windows (PowerShell)
if (Test-Path "$env:USERPROFILE\.openclaude\skills") { "$env:USERPROFILE\.openclaude\skills" }
elseif (Test-Path "$env:USERPROFILE\.claude\skills") { "$env:USERPROFILE\.claude\skills" }
else { "neither exists yet — create one" }
```

## Create the directory

```bash
# macOS / Linux (new install — use .openclaude)
mkdir -p ~/.openclaude/skills

# macOS / Linux (legacy install where ~/.claude already exists)
mkdir -p ~/.claude/skills

# Windows (PowerShell — new install)
New-Item -ItemType Directory -Force "$env:USERPROFILE\.openclaude\skills"
```

## Skill format

Each skill lives in its own subdirectory with a `SKILL.md` file:

```
~/.openclaude/skills/
└── my-commit-ritual/
    └── SKILL.md
```

A minimal `SKILL.md`:

```markdown
---
description: My personal commit ritual
---

Run lint, typecheck, stage specific files, and commit with a conventional message.
Never use `git add .` or `git add -A`.
```

Frontmatter fields:

| Field | Default | Description |
|-------|---------|-------------|
| `description` | — | One-line summary shown in `/skills` |
| `user-invocable` | `true` | Set to `false` to hide from slash-command tab completion |

## Verify discovery

After creating a skill, open OpenClaude in any project and run `/skills` to confirm it appears in the list.

## Why project skills stop at the git root

Project-level `.claude/skills/` directories are scoped to their git repository on purpose: skills from a parent directory should not leak into unrelated child projects. User-level skills (`~/.openclaude/skills/` or `~/.claude/skills/` for legacy installs) are the correct mechanism for cross-project workflows.
