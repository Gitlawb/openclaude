import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { expect, test } from 'bun:test'

const REPO_ROOT = join(import.meta.dir, '..')
const DIST = join(REPO_ROOT, 'dist/cli.mjs')

// Regression for Gitlawb/openclaude#706. The bundled KAIROS dream skill
// (src/skills/bundled/dream.js, not mirrored) must not stub the real
// /dream slash command at src/commands/dream/dream.ts during bundling.
test('/dream command is present in the CLI bundle', () => {
  if (!existsSync(DIST)) {
    throw new Error(
      'dist/cli.mjs not found — run `bun run build` before this test',
    )
  }

  const bundle = readFileSync(DIST, 'utf-8')

  expect(bundle).toContain('consolidating memories')
  expect(bundle).not.toMatch(
    /missing-module-stub:.*commands\/dream\/dream\.js/,
  )
})
