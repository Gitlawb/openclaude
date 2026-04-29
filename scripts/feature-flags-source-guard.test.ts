import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { expect, test } from 'bun:test'

// Regression guard for #856. Several build feature flags require source files
// that are not mirrored into the open build. When such a flag is set to `true`
// without the source present, the bundler falls back to a missing-module stub
// that only exports `default`, which causes runtime errors like
// `fetchMcpSkillsForClient is not a function` when downstream code reaches
// through the `require()` to a named export.
//
// This test fails fast at test-time if someone re-enables one of these flags
// without first mirroring the corresponding source file.

const BUILD_SCRIPT = join(import.meta.dir, 'build.ts')
const REPO_ROOT = join(import.meta.dir, '..')

type FlagGuard = {
  flag: string
  source: string // path relative to repo root
}

const FLAG_REQUIRES_SOURCE: FlagGuard[] = [
  { flag: 'MCP_SKILLS', source: 'src/skills/mcpSkills.ts' },
]

test('build feature flags are not enabled without their source files', () => {
  const buildScript = readFileSync(BUILD_SCRIPT, 'utf-8')

  for (const { flag, source } of FLAG_REQUIRES_SOURCE) {
    const enabledRe = new RegExp(`^\\s*${flag}\\s*:\\s*true\\b`, 'm')
    const isEnabled = enabledRe.test(buildScript)
    const sourceExists = existsSync(join(REPO_ROOT, source))

    if (isEnabled && !sourceExists) {
      throw new Error(
        `Feature flag ${flag} is enabled in scripts/build.ts, but its required source file "${source}" does not exist. ` +
          `Enabling this flag without the source will cause runtime errors (missing named exports from the missing-module stub). ` +
          `Either mirror the source file or set ${flag}: false.`,
      )
    }

    // When the source IS present, the flag can be either true or false; either
    // is fine. We only care about the "enabled but missing" combination.
    expect(true).toBe(true)
  }
})
