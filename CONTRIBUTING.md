# Contributing to OpenClaude

Thanks for contributing.

OpenClaude is a rapidly evolving open-source coding-agent CLI with support for multiple providers, local backends, MCP, and a terminal-first workflow. The project is actively developed and updated frequently. Our current focus is on **stability and performance** — we're prioritizing reliable, well-tested contributions over new feature additions. The best contributions here are focused, well-tested, and easy to review.

## Table of Contents

- [Before You Start](#before-you-start)
- [Proposing New Features](#proposing-new-features)
- [Pull Requests](#pull-requests)
  - [Automated Review (CodeRabbit)](#automated-review-coderabbit)
  - [PR Follow-Up Requirements](#pr-follow-up-requirements)
  - [Duplicate PRs](#duplicate-prs)
  - [What Gets Closed Without Review](#what-gets-closed-without-review)
  - [Contributor Conduct](#contributor-conduct)
  - [Project Consistency](#project-consistency)
- [Development Workflow](#development-workflow)
- [AI Agent Guidelines](#ai-agent-guidelines)
- [Code Style](#code-style)
- [Provider Changes](#provider-changes)
- [Local Setup](#local-setup)
- [Validation](#validation)
- [Community](#community)

## Before You Start

- Search existing [issues](https://github.com/Gitlawb/openclaude/issues) and [discussions](https://github.com/Gitlawb/openclaude/discussions) before opening a new thread.
- Check [open pull requests](https://github.com/Gitlawb/openclaude/pulls) for work that overlaps with your contribution. If a PR already exists that addresses the same change, open an issue or discussion first to align on direction — duplicate PRs may be closed without review.
- Use issues for confirmed bugs and actionable feature work.
- Use discussions for setup help, ideas, and general community conversation.
- For larger changes, open an issue first so the scope is clear before implementation.
- For security reports, follow [SECURITY.md](SECURITY.md).

## Proposing New Features

OpenClaude is moving toward a more **maintainer-directed roadmap**. We are focusing development efforts on stability, performance, and core reliability. As a result, new feature additions are being evaluated more carefully to ensure they align with the project's direction.

**Before investing time in a feature PR, please open an issue first** to propose and discuss your idea with the maintainers. This isn't about gatekeeping — we genuinely value your ideas and want to help shape them into contributions that fit the project's goals. The conversation will help you understand:

- Whether the feature aligns with our current roadmap
- If similar work is already planned or in progress
- The best approach that maintains project consistency

This step prevents wasted effort on PRs that might otherwise be closed without review simply because the feature doesn't match where we're taking the project. Your idea may be great — it just needs to fit the bigger picture.

## Pull Requests

Before opening a PR:

- Read this `CONTRIBUTING.md` file.
- Read [`AGENTS.md`](AGENTS.md) for repo-specific coding-agent conventions, validation commands, provider guidance, and architecture rules.
- Re-check open and recently closed PRs for duplicates.
- Keep the branch focused on one issue or one clearly scoped improvement.
- Run the narrowest meaningful validation command for the touched area.

Every PR needs a reason. Your PR description must include:

- confirmation that you reviewed both this `CONTRIBUTING.md` file and [`AGENTS.md`](AGENTS.md)
- what changed and why
- the user or developer impact
- the exact checks you ran
- a linked issue when one exists, using `Fixes #123`, `Closes #123`, or another clear link
- screenshots when the PR touches UI, terminal presentation, or the VS Code extension
- which provider path was tested when the PR changes provider behavior

The PR author is responsible for ensuring their PR is merge-ready. PRs with merge conflicts will not be reviewed or approved until the conflicts are resolved.

Issues are the recommended starting point for anything non-trivial — opening one first helps avoid wasted effort if the change is out of scope or already being worked on. Small fixes, doc corrections, and obvious improvements can stand on their own without a linked issue, as long as the PR description explains the intent.

### Automated Review (CodeRabbit)

We use [CodeRabbit](https://coderabbit.ai) to assist with PR reviews. CodeRabbit will automatically review your PR and leave comments on potential issues, bugs, or style concerns.

**PR authors must address CodeRabbit findings** — do not ignore its comments and wait for a maintainer override. If you're waiting for a maintainer review and CodeRabbit has completed its review with findings, fix those findings first. Maintainer reviews will not proceed until automated review feedback has been addressed.

### PR Follow-Up Requirements

Submitting a PR is a commitment to see it through. Please be prepared to:

- **Respond to review feedback within 1 week** of a maintainer or CodeRabbit review request
- **If you need more time**, leave a comment explaining your situation and expected timeline
- **PRs with no activity for 2 weeks after a review request** will be closed as abandoned. At that point, another contributor may pick up the work under a new PR

This policy ensures the project stays maintainable and that contributor queue doesn't grow stale. We understand life happens — a quick note explaining a delay goes a long way.

### Duplicate PRs

We are proactive about closing duplicate PRs. Before submitting, **it is your responsibility to check** whether a similar PR already exists:

- Search [open pull requests](https://github.com/Gitlawb/openclaude/pulls) for related work
- Check [closed pull requests](https://github.com/Gitlawb/openclaude/pulls?q=is%3Apr+is%3Aclosed) to see if similar work was previously addressed or declined
- If you find an existing PR, engage in that thread rather than opening a new one

Duplicate PRs will likely be closed without review or follow-up. This isn't personal — it's about keeping the review queue focused and efficient.

### What Gets Closed Without Review

PRs may be closed without review if they:

- duplicate work already covered by an open pull request
- bundle unrelated fixes, features, or refactors into a single PR without prior discussion and maintainer approval
- add features, refactors, or dependency changes that were not discussed first
- drift from the approved scope of a linked issue
- change the project's language, core runtime, or dependency stack without prior maintainer agreement
- are drive-by contributions with no context, no tests, and no clear purpose
- are automated bounty-hunting or mass-submitted PRs that provide little meaningful value to the codebase
- are advertisements, sales pitches, or promotional submissions for a product or service — open an issue first to discuss with maintainers if you believe your product or service is relevant to this project

This is not a judgment on the contributor. It is how the project stays reviewable. If your PR is closed, the best next step is to open an issue, clarify the intent, and get alignment before re-submitting.

### Contributor Conduct

We want OpenClaude to be a welcoming community, but we must also protect the project's quality and contributor time. The following actions will result in a **ban from future contributions**:

- Repeated fly-by PRs with no follow-up after review requests
- Repeated submission of duplicate PRs
- Ignoring CodeRabbit findings and waiting for maintainer override
- Automated or mass-submitted PRs that provide little meaningful value

We don't take this lightly. If you're unsure whether your contribution is a good fit, open an issue first — we're happy to help guide you.

### Project Consistency

Stay within the project's existing technical direction. PRs that shift the codebase to a new language, significantly restructure dependencies, or introduce a new runtime are unlikely to be accepted without prior discussion.

Dependency changes need a clear project benefit — fixing a bug, addressing a security issue, or supporting an approved feature. Preference-based reasoning alone is not enough — explain the concrete benefit.

## Development Workflow

- Keep PRs focused on one problem or feature.
- Avoid mixing unrelated cleanup into the same change.
- Preserve existing repo patterns unless the change is intentionally refactoring them.
- Add or update tests when the change affects behavior.
- Update docs when setup, commands, or user-facing behavior changes.

AI-assisted and vibe-coded contributions are welcome, but please review your own changes thoroughly before opening a PR. Even frontier models produce subtle bugs, incorrect assumptions, and code that looks right but isn't.

Before submitting, run multiple rounds of review on generated code:

- check for correctness, not just whether it compiles
- verify style consistency with the rest of the codebase
- remove unnecessary changes or auto-generated noise
- confirm adherence to the project's patterns and architecture
- ask your AI assistant "are you sure there are no issues with this code?" — this alone can surface problems that would otherwise slip through

Self-review up front saves everyone time and reduces back-and-forth during maintainer review.

## AI Agent Guidelines

If you are an AI agent (Copilot, Cursor, Claude, etc.) working on this codebase, refer to [AGENTS.md](AGENTS.md) for project-specific coding guidelines, conventions, and validation commands. Following these guidelines will help your contributions align with the project's patterns and reduce review friction.

## Code Style

- Follow the existing code style in the touched files.
- Prefer small, readable changes over broad rewrites.
- Do not reformat unrelated files just because they are nearby.
- Keep comments useful and concise.

## Provider Changes

OpenClaude supports multiple provider paths. Before contributing provider changes, review the relevant documentation to ensure your implementation follows the expected patterns:

- start with `docs/integrations/overview.md` for an understanding of how integrations are structured
- use the focused how-to guides under `docs/integrations/how-to/` for new vendors, gateways, models, anthropic proxies, and `/usage` support
- PRs that skip documented patterns or introduce inconsistent provider behavior may be sent back for rework

When submitting provider changes:

- be explicit about which providers are affected
- avoid breaking third-party providers while fixing first-party behavior
- test the exact provider/model path you changed when possible
- call out any limitations or follow-up work in the PR description
- do not assign or use provider tags — these are controlled by maintainers and will be applied during review

## Local Setup

Install dependencies:

```bash
bun install
```

Build the CLI:

```bash
bun run build
```

Smoke test:

```bash
bun run smoke
```

Full local check:

```bash
bun run check
```

Run the app locally:

```bash
bun run dev
```

If you are working on provider setup or saved profiles, useful commands include:

```bash
bun run profile:init
bun run dev:profile
```

## Validation

CI runs the following checks on every PR. Run the relevant ones locally before pushing.

Full check (smoke + unit tests):

```bash
bun run check
```

Full test pass (single concurrency, matches CI):

```bash
bun run test:full
```

Provider tests:

```bash
bun run test:provider
```

Provider recommendation tests:

```bash
bun run test:provider-recommendation
```

Typecheck (enforced by the dedicated `typecheck` CI job):

```bash
bun run typecheck
bun run typecheck:type-tests
```

PR intent scan:

```bash
bun run security:pr-scan
```

Web (if touching `web/`):

```bash
bun run web:typecheck
bun run web:build
```

PRs that fail CI checks will not be merged.

### Recommended Local Checks

These are not enforced by CI but are worth running locally before submitting.

Focused tests:

```bash
bun test ./path/to/test-file.test.ts
```

Provider/runtime diagnostics:

```bash
bun run doctor:runtime
```

## Community

Please be respectful and constructive with other contributors.

Maintainers may ask for:

- narrower scope
- focused follow-up PRs
- stronger validation
- docs updates for behavior changes

That is normal and helps keep the project reviewable as it grows.
