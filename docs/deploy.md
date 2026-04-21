# Deploy and install OpenClaude

This document covers every supported way to get **`openclaude`** onto a machine: from npm, from a source checkout, as a tarball, and how **upstream** publishes. Fork maintainers: see **Fork-scoped npm** at the end.

## Quick reference (`package.json`)

| Script | Equivalent shell |
|--------|-------------------|
| `bun run deploy:registry` | `bash scripts/deploy-from-source.sh registry` |
| `bun run deploy:install-global` | `bash scripts/deploy-from-source.sh global` |
| `bun run deploy:link` | `bash scripts/deploy-from-source.sh link` |
| `bun run deploy:pack` | `bash scripts/deploy-from-source.sh pack` |

Run `bash scripts/deploy-from-source.sh help` for the same usage text. Palette tasks **OpenClaude: deploy pack** / **OpenClaude: deploy link** live in `.vscode/tasks.json` (PATH via `cursor-dev-path.sh`).

## 1. Install from npm (recommended for users)

Uses the package published by maintainers (`@gitlawb/openclaude`).

```bash
npm install -g @gitlawb/openclaude@latest
openclaude --version
```

From the repo you can run the same via:

```bash
bun run deploy:registry
# equivalent: bash scripts/deploy-from-source.sh registry
```

## 2. Global install from a git checkout

After cloning, install dependencies, build the bundle, then install globally from the current directory.

```bash
cd openclaude
bun install --frozen-lockfile
bun run deploy:install-global
# equivalent: bash scripts/deploy-from-source.sh global
```

Requires **Bun** and **npm**. This installs whatever **`version`** is set to in **`package.json`** at install time.

## 3. Development link (`npm link`)

Keeps `openclaude` pointing at your working tree (good for active development).

```bash
bun install --frozen-lockfile
bun run deploy:link
# equivalent: bash scripts/deploy-from-source.sh link
```

## 4. Pack a tarball (CI, air-gapped, or manual install)

`npm pack` runs **`prepack`** → **`npm run build`**, so you get a built tarball without a separate build step.

```bash
bun install --frozen-lockfile
bun run deploy:pack
# equivalent: bash scripts/deploy-from-source.sh pack
```

Install elsewhere (use the **exact** `.tgz` name printed by `npm pack`, or a glob that resolves to one file):

```bash
npm install -g ./gitlawb-openclaude-<version>.tgz
# e.g. ./gitlawb-openclaude-0.5.2.tgz — the middle segment matches package.json "version"
```

## 5. Upstream automated release (GitHub + npm + GHCR)

On **`Gitlawb/openclaude`** only, pushing to **`main`** runs **Release Please**. When it opens and merges a release PR and creates a tag, CI publishes:

- **`npm publish`** for `@gitlawb/openclaude` (with provenance)
- **Docker** image to `ghcr.io/gitlawb/openclaude`

Forks (`github.repository != 'Gitlawb/openclaude'`) do **not** run that workflow gate—see `.github/workflows/release.yml` `if:` conditions.

## 6. Fork-scoped npm package (optional)

To publish **your fork** under your own scope (example: `@myuser/openclaude`):

1. Change **`package.json`** field **`name`** to your scope (and update **`bin`** / docs references if you rename the CLI—non-trivial).
2. Ensure **`publishConfig.access`** matches your registry policy.
3. `npm login` and **`npm publish --access public`** from a clean **`bun run build`** tree.

Do not publish to **`@gitlawb`** unless you are a maintainer with npm access. Prefer contributing upstream and using the **registry install** or **upstream automated release** paths above for end users.

## See also

- [Advanced setup](./advanced-setup.md) — source builds, `npm link`, providers.
- [README](../README.md) — quick start and links.
- [SECURITY.md](../SECURITY.md) — release and disclosure policy.
