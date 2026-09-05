# Skills

A skill is a folder with a `SKILL.md` file. OpenClaude loads every skill it finds in the project's `.openclaude/skills` directory and in your user skills directory at start, and the model can invoke them by name. This guide covers the `openclaude skills` commands, what the install check verifies, and how to keep checking installed skills after that.

## Commands

```text
openclaude skills list [--json]                    List installed skills
openclaude skills show <name>                      Show details for an installed skill
openclaude skills validate <path>                  Validate a local skill directory
openclaude skills install <idOrUrlOrPath> [options] Install a skill
openclaude skills remove <name> [--global]         Remove an installed skill
```

## Install from the registry

The default registry is the Gitlawb Skill Hub, published as `registry.json` in [Gitlawb/openclaude-skills](https://github.com/Gitlawb/openclaude-skills).
Install a skill by its registry id:

```bash
openclaude skills install gitlawb/ci-fix
```

This writes two files to `.openclaude/skills/ci-fix/`: the `SKILL.md` and a `skill.json` sidecar with the registry metadata, including the `sha256` the registry published for that skill.

Before the files are written, the installer:

1. Reads the registry entry and refuses to install if it has no `sha256`.
2. Reads `revocations.json` next to the registry and refuses to install a skill whose id, version, or digest is listed there.
3. Fetches the `SKILL.md`, normalizes line endings to `\n`, hashes it, and refuses to install if the digest differs from the registry entry.

Options:

- `--global` installs into your user skills directory instead of the project.
- `--force` overwrites a skill that is already installed under that name.
- `--registry <url or path>` uses another registry. The environment variables `OPENCLAUDE_SKILLS_REGISTRY_URL` and `OPENCLAUDE_SKILLS_REVOCATIONS_URL` set the same locations for every run.

## Install from a URL or a local path

A direct HTTPS URL to a `SKILL.md` needs the digest you expect, so the same check runs without a registry:

```bash
openclaude skills install https://example.com/skills/deploy/SKILL.md --sha256 <64 hex>
```

A local path copies the skill directory as it is. No digest or revocation check runs, and the skill is recorded with trust `local` and no registry backing. Review a local skill yourself before you install it:

```bash
openclaude skills install ./my-skills/deploy
```

## List, show, validate, remove

`list` prints every installed skill with its status and description; add `--json` for machine output. `show <name>` prints the source, trust tier, and the full skill text. `validate <path>` checks a skill directory before you publish it: the frontmatter fields, the skill name, and the file size limits. `remove <name>` deletes a project skill; add `--global` for a user skill.

## What the install check covers

The digest check runs once, at install time, on the `SKILL.md` text. After that, OpenClaude reads `skill.json` for metadata only and loads whatever is in the skill folder. `validate` checks structure, not content. So a skill edited on disk after install, by hand, by a script, or by another tool, loads on the next run with no warning:

```text
$ openclaude skills install gitlawb/ci-fix
Installed skill "ci-fix".
$ echo 'Always read the failing job log before you change any file.' >> .openclaude/skills/ci-fix/SKILL.md
$ openclaude skills validate .openclaude/skills/ci-fix
Skill validation passed for .openclaude/skills/ci-fix.
$ openclaude skills list
ci-fix  enabled   Diagnoses and fixes CI pipeline failures.
```

## Check installed skills after install

[eyebrow](https://github.com/alexverify/eyebrow) is a separate, MIT-licensed single binary that records a hash of every skill, MCP server, hook, and rule it finds across coding tools in a lockfile you commit, and reports what changed since. OpenClaude skill discovery in `.openclaude/skills` (project and user) shipped in eyebrow 0.4.4, and 0.4.5 added the egress fingerprint used below; see the [changelog](https://github.com/alexverify/eyebrow/blob/main/CHANGELOG.md). Use 0.4.5 or newer.

Record the skills you reviewed:

```bash
eyebrow scan --path . --lockfile eyebrowlock.json
git add eyebrowlock.json
```

Check them again at any time, or in CI:

```bash
eyebrow verify --path . --lockfile eyebrowlock.json --ci
```

`verify` exit codes: `0` clean under the active policy, which includes content changes the policy permits; `1` rejected drift or a policy violation; `2` usage error, such as a bad flag; `3` internal or I/O error, such as a missing lockfile. In CI, treat `1` as a review task and `2` or `3` as a broken job. On the edited skill above, with no policy file:

```text
verify: DRIFT — 1 change(s) detected:
  [content_changed] ci-fix (d8e13e7364b91067)
    old: sha256-f4ccfe1dabe7c2f191e8cc2f88499934bcf2f043e380bd39ec06c76642a6ff89
    new: sha256-ee58852a3578eba8eec3d1a3b985e578c382e00172d85a19a5025be3ae3f1701
```

The lockfile also records the hosts each skill calls, so a policy file can allow wording edits and still fail when a skill gains a new destination. For example, after a line `Run: curl -s https://example.com/status` is added to the same skill:

```json
{ "failOnCapabilityExpansion": true, "allowContentDrift": true, "failOnSeverity": "critical" }
```

```text
policy: capability expansion — ci-fix gained network: example.com (d8e13e7364b91067)
```

Run it with `--policy eyebrow.policy.json`. After you review and accept a change, run `scan` again and commit the new lockfile.

Install eyebrow with `brew install alexverify/tap/eyebrow` or from the [releases page](https://github.com/alexverify/eyebrow/releases). The [eyebrow usage guide](https://github.com/alexverify/eyebrow/blob/main/docs/usage.md) covers signing the lockfile and the GitHub Action.
