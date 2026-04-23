# Memory (durable facts)

Handbook **v2** · last structurally updated **2026-04-23** (MCP merge + Cursor tuning). Trim or correct freely.

## User / environment

- **OS:** macOS (darwin), **shell:** zsh, **editor:** Cursor.
- **Home:** `/Users/adrianstanca`.
- **Go:** `go1.26.2` darwin/arm64; `gopls`, `staticcheck` under `$(go env GOPATH)/bin` (typically `/Users/adrianstanca/go/bin`); **Homebrew** `golangci-lint` (2.x).
- **PATH:** `~/.zshrc` includes `$HOME/bin` and `$HOME/go/bin` early so Go tools resolve in new shells.
- **Secrets:** `~/.zshrc` sources `~/.env.keys` when present — keep keys there or in provider dashboards, never in chat or git.

## Cursor / agent stack

- **MCP:** `~/.cursor/mcp.json` → symlink to **`~/.claude/mcp.json`** (single source of truth). **2026-04-23:** merged dormant servers from the old `mcp.extra-servers.json` into `mcp.json` (backup **`~/.claude/mcp.backup-premerge-20260423.json`**). **`filesystem`** MCP is scoped to Desktop + main repos + `~/skills`, not full `$HOME`. **`semgrep`** MCP uses **`/opt/homebrew/bin/semgrep`** (Homebrew). **`mcp.extra-servers.json`** is an empty stub for future optional servers. **`npx`** invocations use **`/opt/homebrew/bin/npx`** so GUI-launched tools resolve without a login shell PATH. **Git snapshots** of `mcp.json`, `mcp.extra-servers.json`, and Cursor `settings.json` live under this repo’s **`config/`**; run **`bash scripts/apply-machine-config.sh`** from the handbook root to re-apply MCP to the home directory after pulling.
- **Skills CLI:** packages under **`~/.agents/skills/`** (Vercel, Anthropic, Composio, Codex, Gemini CLI, media/LLM helpers, etc.), registered for Cursor among others.
- **Personal skills:** **`~/.cursor/skills/`** — this handbook is `local-handbook/`. Do **not** write into **`~/.cursor/skills-cursor/`** (Cursor-managed).
- **Machine perf (rolling):** MCP edits go to **`~/.claude/mcp.json`**; optional **`mcp.extra-servers.json`** is empty unless you add new servers there before merging. Restore older MCP from **`~/.claude/mcp.backup-full-2026-04-22.json`** or pre-merge backup if needed. Cursor **`~/Library/Application Support/Cursor/User/settings.json`**: watchers, search excludes, tab limit, large terminal scrollback, **`typescript.tsserver.maxTsServerMemory` 8192**, **`diffEditor.ignoreTrimWhitespace`**, **`cursor.modelFactory.automatedTaskModel`** set to **`claude-4-sonnet`** (keep in sync with **Settings → Models**). Default Python **`/opt/homebrew/bin/python3.12`**. Shell **`~/.zshrc`**: **`/opt/homebrew/bin` first on PATH**, zsh-only guard, lazy NVM, **`add-zsh-hook`** + `vcs_info`, large deduped history, **`fzfp`**. Roll back from **`~/.zshrc.backup-*`** / **`settings.backup-*`** when needed.
- **Handbook backup git:** `~/.cursor/skills/local-handbook/` is its own repo; **remote** `https://github.com/adrianstanca1/cursor-local-handbook.git` (**private**). After editing these files: `git add -A && git commit -m "..." && git push` from that directory (use **`PATH="/opt/homebrew/bin:$PATH"`** if `gh`/`git` not on PATH in automation shells).

## Coding preferences (standing)

- Prefer **plain, direct language**; avoid decorative bold/backticks.
- **No `§`** in user-facing text (rendering issues).
- Avoid **engagement-bait** endings; optional follow-ups only when useful.
- **Todos:** mark completed as you go; do not leave items `in_progress` when finished.

## Repos using this handbook

- **`/Users/adrianstanca/Desktop/openclaude-main`** — `.cursor/skills/local-handbook/`. **`origin`** `https://github.com/adrianstanca1/openclaude.git`, **`upstream`** `https://github.com/Gitlawb/openclaude.git`. Fork **PR #1 merged** (2026-04-19); **`sync/cursor-handbook`** removed. **`main`** tracks **`upstream/main`** (merge **`2915f62`** was used to sync). **Canonical repo guide:** root **`AGENTS.md`** (added per upstream review); Cursor skill under **`.cursor/skills/local-handbook/`** defers to it. Latest fork tip includes **`8eeb7b8`** (`docs: add AGENTS.md and slim Cursor handbook`). **Upstream PR:** `https://github.com/Gitlawb/openclaude/pull/766` — **CHANGES_REQUESTED** addressed via **`AGENTS.md`** + PR comment `https://github.com/Gitlawb/openclaude/pull/766#issuecomment-4277513488`. Local backup branch **`backup/local-main-before-align-20260419`** was deleted earlier.
- **`/Users/adrianstanca/autoresearch-trio`** — `.cursor/skills/local-handbook/`. Branch **`cursor/autoimprove-trio-session-log`** tracks **`origin/cursor/autoimprove-trio-session-log`**.
- **`/Users/adrianstanca/cortexbuild-ultimate`** — `.cursor/skills/local-handbook/`. **`main`** uses **Husky** — commits must satisfy **Conventional Commits** (`type(scope): description`, description starts lowercase).

## Git / push (snapshot)

- **autoresearch-trio:** handbook updates **pushed** on `cursor/autoimprove-trio-session-log` (latest includes v2 handbook).
- **cortexbuild-ultimate:** handbook v2 is on **`main`** as **`59256b9`** and **pushed** to `origin/main` (cherry-picked from a feature-branch commit after accidental commit there; your prior WIP edits were **stashed then restored** on `cursor/deploy-scripts-and-build-workflow`).
- **openclaude fork:** PR branch **`sync/cursor-handbook`** was **rebased** onto newer `origin` and **pushed** (`a65e657` area); PR `https://github.com/adrianstanca1/openclaude/pull/1` now includes the enhanced files.

## Quick verify hints (global)

- **Go module:** `go test ./...` from module root when the change touches Go code.
- **Any repo:** prefer the **script named in that repo’s `package.json` / `Makefile` / `pyproject`** over guessing commands.

## Session log (optimization)

- **2026-04-23 (continuation):** `infsh` / `belt` updated to **v1.8.8** (`infsh update`). **Ollama** responds on **`127.0.0.1:11434`** (processes running). **Cursor plugin MCP `mcp_auth`:** completed for **`plugin-vercel-vercel`** and **`plugin-supabase-supabase`**; Stripe and Slack were **user-skipped** in the auth UI; Notion, Sentry, Greptile, and Amplitude **timed out** (retry from **Cursor → MCP** when you have time); **GitLab** auth failed with **SSE 404** (reinstall or check GitLab plugin / endpoint). **VS Code** `User/mcp.json` was rebuilt from a corrupt backup; keep timestamped **`mcp.json.corrupt-backup-*`** until you confirm VS Code MCP is stable.

## Anti-patterns

- Claiming green CI/tests without running the relevant command **in this session**.
- Pasting or logging **credentials**; **`git push --force`** without explicit approval.
- Large speculative refactors unrelated to the stated task.
