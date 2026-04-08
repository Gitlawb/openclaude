import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { loadLauncherEnv } from './launcher-env.mjs'

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), 'openclaude-launcher-env-'))
}

test('loads provider env from the current project .env without overriding shell values', () => {
  const tempDir = makeTempDir()

  try {
    writeFileSync(
      join(tempDir, '.env'),
      [
        'CLAUDE_CODE_USE_OPENAI=1',
        'OPENAI_API_KEY=from-project-dotenv',
        'OPENAI_MODEL=from-project-dotenv',
      ].join('\n'),
    )

    const env = {
      OPENAI_MODEL: 'from-shell',
    }

    const loadedFiles = loadLauncherEnv({
      cwd: tempDir,
      env,
      packageRoot: join(tempDir, 'package-root'),
      homeDir: tempDir,
    })

    assert.equal(env.CLAUDE_CODE_USE_OPENAI, '1')
    assert.equal(env.OPENAI_API_KEY, 'from-project-dotenv')
    assert.equal(env.OPENAI_MODEL, 'from-shell')
    assert.deepEqual(loadedFiles, [join(tempDir, '.env')])
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('falls back to the installed package .env when the project has none', () => {
  const tempDir = makeTempDir()

  try {
    const packageRoot = join(tempDir, 'package-root')
    mkdirSync(packageRoot, { recursive: true })
    writeFileSync(
      join(packageRoot, '.env'),
      [
        'CLAUDE_CODE_USE_OPENAI=1',
        'OPENAI_API_KEY=from-package-dotenv',
        'OPENAI_BASE_URL=https://openrouter.ai/api/v1',
      ].join('\n'),
    )

    const env = {}

    const loadedFiles = loadLauncherEnv({
      cwd: join(tempDir, 'project'),
      env,
      packageRoot,
      homeDir: tempDir,
    })

    assert.equal(env.CLAUDE_CODE_USE_OPENAI, '1')
    assert.equal(env.OPENAI_API_KEY, 'from-package-dotenv')
    assert.equal(env.OPENAI_BASE_URL, 'https://openrouter.ai/api/v1')
    assert.deepEqual(loadedFiles, [join(packageRoot, '.env')])
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})
