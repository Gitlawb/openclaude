# User-Level Skills

Skills you place in `~/.claude/skills/` (or `~/.openclaude/skills/` on new installs) are available in **every project**, regardless of which directory you open.

This is useful for personal workflows — commit rituals, session wrap-ups, bug-hunt flows — that you want available everywhere without copying files into each repo.

## Where to put them

| Location | Scope |
|----------|-------|
| `<project>/.claude/skills/` | Current project only |
| `~/.claude/skills/` | All projects (user-level) |
| `~/.openclaude/skills/` | All projects (new installs without a legacy `~/.claude/`) |

OpenClaude checks `~/.claude/` first if that directory already exists, otherwise uses `~/.openclaude/`. Run this to confirm which one applies to you:

```bash
# macOS / Linux
ls ~/.claude/skills/ 2>/dev/null || ls ~/.openclaude/skills/ 2>/dev/null || echo "neither exists yet"

# Windows (PowerShell)
if (Test-Path "$env:USERPROFILE\.claude\skills") { "$env:USERPROFILE\.claude\skills" }
elseif (Test-Path "$env:USERPROFILE\.openclaude\skills") { "$env:USERPROFILE\.openclaude\skills" }
else { "neither exists yet — create one" }
```

## Create the directory

```bash
# macOS / Linux — pick whichever path applies to you
mkdir -p ~/.claude/skills
# or
mkdir -p ~/.openclaude/skills

# Windows (PowerShell)
New-Item -ItemType Directory -Force "$env:USERPROFILE\.claude\skills"
```

## Skill format

Each skill lives in its own subdirectory with a `SKILL.md` file:

```
~/.claude/skills/
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

Project-level `.claude/skills/` directories are scoped to their git repository on purpose: skills from a parent directory should not leak into unrelated child projects. User-level skills (`~/.claude/skills/`) are the correct mechanism for cross-project workflows.
