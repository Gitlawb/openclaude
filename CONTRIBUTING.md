# Contributing to OpenClaude

Thanks for contributing.

OpenClaude is a fast-moving open-source coding-agent CLI with support for multiple providers, local backends, MCP, and a terminal-first workflow. The best contributions here are focused, well-tested, and easy to review.

## Before You Start

- Search existing [issues](https://github.com/Gitlawb/openclaude/issues) and [discussions](https://github.com/Gitlawb/openclaude/discussions) before opening a new thread.
- Check [open pull requests](https://github.com/Gitlawb/openclaude/pulls) for work that overlaps with your contribution. If a PR already exists that addresses the same change, open an issue or discussion first to align on direction — duplicate PRs may be closed without review.
- Use issues for confirmed bugs and actionable feature work.
- Use discussions for setup help, ideas, and general community conversation.
- For larger changes, open an issue first so the scope is clear before implementation.
- For security reports, follow [SECURITY.md](SECURITY.md).

## Pull Requests

Every PR needs a reason. Your PR description must include:

- what changed and why
- the user or developer impact
- the exact checks you ran
- a linked issue when one exists, using `Fixes #123`, `Closes #123`, or another clear link
- screenshots when the PR touches UI, terminal presentation, or the VS Code extension
- which provider path was tested when the PR changes provider behavior

The PR author is responsible for ensuring their PR is merge-ready. PRs with merge conflicts will not be reviewed or approved until the conflicts are resolved.

Issues are the recommended starting point for anything non-trivial — opening one first helps avoid wasted effort if the change is out of scope or already being worked on. Small fixes, doc corrections, and obvious improvements can stand on their own without a linked issue, as long as the PR description explains the intent.

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

This is not a judgment on the contributor. It is how the project stays reviewable. If your PR is closed, the best next step is to open an issue, clarify the intent, and get alignment before re-submitting. Contributors who repeatedly submit automated or bounty-driven PRs with no real substance will be banned from future contributions.

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

Python tests:

```bash
python -m pytest -q python/tests
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

Typecheck:

```bash
bun run typecheck
```

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
