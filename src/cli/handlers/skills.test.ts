import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'bun:test'

import type { Command } from '../../types/command.js'
import { skillsInstallHandler } from './skillsInstall.ts'
import {
  formatSkillsListForDisplay,
  formatSkillsListJson,
} from './skillsListFormat.ts'
import { getSkillRemoveNotFoundMessage } from './skillsRemoveMessage.ts'

type SkillCommand = Command & { type: 'prompt' }

const VALID_SKILL = `---
name: sample-skill
title: Sample Skill
description: Sample skill used by install tests.
version: 0.1.0
category: test
author: OpenClaude Tests
license: MIT
trust: local
---

# Sample Skill

Use this skill for install tests.
Document token scopes without storing secret values.
`

const PATH_TRAVERSAL_SKILL = `---
name: ../escape
title: Unsafe Skill
description: Invalid skill used by install tests.
version: 0.1.0
category: test
author: OpenClaude Tests
license: MIT
trust: local
---

# Unsafe Skill
`

function skill(
  name: string,
  description: string | undefined,
  source: SkillCommand['source'] = 'bundled',
): SkillCommand {
  return {
    type: 'prompt',
    name,
    description: description ?? '',
    hasUserSpecifiedDescription: description !== undefined,
    progressMessage: 'running',
    contentLength: description?.length ?? 0,
    source,
    loadedFrom: source === 'bundled' ? 'bundled' : 'skills',
    userInvocable: true,
    async getPromptForCommand() {
      return []
    },
  }
}

function writeSkillDir(root: string): string {
  const skillDir = join(root, 'sample-skill')
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(join(skillDir, 'SKILL.md'), VALID_SKILL, 'utf8')
  return skillDir
}

function sha256OfSkillSource(text: string): string {
  return createHash('sha256')
    .update(text.replace(/\r\n/g, '\n'), 'utf8')
    .digest('hex')
}

async function withTempDir<T>(fn: (tempDir: string) => Promise<T>): Promise<T> {
  const tempDir = mkdtempSync(join(tmpdir(), 'openclaude-skill-install-test-'))
  try {
    return await fn(tempDir)
  } finally {
    process.exitCode = 0
    rmSync(tempDir, { recursive: true, force: true })
  }
}

test('formats skills list as an aligned human table', () => {
  const output = formatSkillsListForDisplay(
    [
      skill(
        'batch',
        'Research and plan a large-scale change, then execute it in parallel across 5–30 isolated worktree agents that each open a PR.',
        'projectSettings',
      ),
      skill(
        'debug',
        'Enable debug logging for this session and help diagnose issues.',
        'userSettings',
      ),
      skill(
        'loop',
        'Run a prompt on a fixed interval or dynamically reschedule it, including bare maintenance-mode loops.',
        'projectSettings',
      ),
      skill(
        'simplify',
        'Review changed code for reuse, quality, and efficiency, then fix any issues found.',
        'projectSettings',
      ),
      skill(
        'update-config',
        'Use this skill to configure the Claude Code harness via settings.json. Automated behaviors require hooks.',
        'projectSettings',
      ),
    ],
    80,
  )

  assert.match(output, /^Skills: 5 enabled/)
  assert.match(output, /Name\s+Status\s+Description/)
  assert.doesNotMatch(output, /\bSource\b/)
  assert.doesNotMatch(output, /source: bundled \| trust:/)
  assert.doesNotMatch(output, /\bbundled\b/)
  assert.match(output, /batch\s+enabled\s+Research and plan/)
  assert.match(output, /update-config\s+enabled\s+Configure the Claude Code harness via/)
})

test('omits source column while preserving installed rows', () => {
  const output = formatSkillsListForDisplay(
    [
      skill('docs-writer', 'Writes project documentation.', 'projectSettings'),
      skill('pr-review', 'Reviews pull requests.', 'userSettings'),
      skill('debug', 'Enable debug logging.', 'bundled'),
    ],
    100,
  )

  assert.doesNotMatch(output, /\bSource\b/)
  assert.doesNotMatch(output, /docs-writer\s+enabled\s+project\s+/)
  assert.doesNotMatch(output, /pr-review\s+enabled\s+user\s+/)
  assert.match(output, /docs-writer\s+enabled\s+Writes project documentation\./)
  assert.match(output, /pr-review\s+enabled\s+Reviews pull requests\./)
  assert.doesNotMatch(output, /\bdebug\b/)
  assert.doesNotMatch(output, /Enable debug logging/)
})

test('omits bundled skills from the human table', () => {
  const output = formatSkillsListForDisplay(
    [
      skill('debug', 'Enable debug logging.', 'bundled'),
      skill('docs-writer', 'Writes project documentation.', 'projectSettings'),
    ],
    100,
  )

  assert.match(output, /^Skills: 1 enabled/)
  assert.doesNotMatch(output, /\bdebug\b/)
  assert.doesNotMatch(output, /Enable debug logging/)
  assert.match(output, /docs-writer\s+enabled\s+Writes project documentation\./)
})

test('wraps description continuations under the Description column', () => {
  const output = formatSkillsListForDisplay(
    [
      skill(
        'batch',
        'Research and plan a large-scale change, then execute it in parallel across 5–30 isolated worktree agents that each open a PR.',
        'projectSettings',
      ),
    ],
    45,
  )
  const lines = output.split('\n')
  const header = lines.find(line => line.includes('Description'))
  assert.ok(header)
  const descriptionColumn = header.indexOf('Description')
  const continuation = lines.find(line =>
    line.trim().startsWith('large-scale change'),
  )
  assert.ok(continuation)
  assert.equal(continuation.search(/\S/), descriptionColumn)
})

test('formats empty skills list cleanly', () => {
  assert.equal(
    formatSkillsListForDisplay([], 100),
    'Skills: 0 enabled\n\nNo skills found.',
  )
})

test('formats all-bundled skills as empty in the human table', () => {
  assert.equal(
    formatSkillsListForDisplay(
      [skill('debug', 'Enable debug logging.', 'bundled')],
      100,
    ),
    'Skills: 0 enabled\n\nNo skills found.',
  )
})

test('formats skills list json as machine-readable metadata', () => {
  const description = 'Full description should remain in JSON. Extra sentence stays.'
  const parsed = JSON.parse(
    formatSkillsListJson([
      skill('debug', description, 'projectSettings'),
      skill('batch', 'Bundled skill should stay hidden.', 'bundled'),
    ]),
  ) as {
    enabledCount: number
    skills: Array<{ name: string; source: string; description: string }>
  }

  assert.equal(parsed.enabledCount, 1)
  assert.equal(parsed.skills[0]?.name, 'debug')
  assert.equal(parsed.skills[0]?.source, 'project')
  assert.equal(parsed.skills[0]?.description, description)
  assert.equal(parsed.skills.length, 1)
  assert.equal(
    parsed.skills.some(item => item.name === 'batch'),
    false,
  )
})

test('formats all-bundled skills as empty json', () => {
  const parsed = JSON.parse(
    formatSkillsListJson([
      skill('batch', 'Research and plan large-scale changes.', 'bundled'),
      skill('debug', 'Enable debug logging.', 'bundled'),
    ]),
  ) as {
    enabledCount: number
    skills: Array<{ name: string }>
  }

  assert.equal(parsed.enabledCount, 0)
  assert.deepEqual(parsed.skills, [])
})

test('explains remove scope mismatch for globally installed skills', () => {
  assert.equal(
    getSkillRemoveNotFoundMessage(
      [skill('pr-review', 'Reviews pull requests.', 'userSettings')],
      'pr-review',
      {},
    ),
    'Skill "pr-review" is installed globally. Use --global to remove it.',
  )
})

test('explains remove scope mismatch for project installed skills', () => {
  assert.equal(
    getSkillRemoveNotFoundMessage(
      [skill('docs-writer', 'Writes documentation.', 'projectSettings')],
      'docs-writer',
      { global: true },
    ),
    'Skill "docs-writer" is installed in this project. Remove it without --global.',
  )
})

test('keeps remove not-found generic for hidden bundled skills', () => {
  assert.equal(
    getSkillRemoveNotFoundMessage(
      [skill('batch', 'Bundled skill.', 'bundled')],
      'batch',
      {},
    ),
    'Skill "batch" not found.',
  )
})

test.serial('installs a local skill directory into project skills by default', async () => {
  await withTempDir(async tempDir => {
    const cwd = join(tempDir, 'project')
    const source = writeSkillDir(join(tempDir, 'source'))
    mkdirSync(cwd, { recursive: true })

    await skillsInstallHandler(source, { projectDir: cwd })

    const installed = readFileSync(
      join(cwd, '.openclaude', 'skills', 'sample-skill', 'SKILL.md'),
      'utf8',
    )
    assert.equal(installed, VALID_SKILL)
  })
})

test.serial('refuses to overwrite installed skills without --force', async () => {
  await withTempDir(async tempDir => {
    const cwd = join(tempDir, 'project')
    const source = writeSkillDir(join(tempDir, 'source'))
    mkdirSync(join(cwd, '.openclaude', 'skills', 'sample-skill'), {
      recursive: true,
    })
    writeFileSync(
      join(cwd, '.openclaude', 'skills', 'sample-skill', 'SKILL.md'),
      'existing skill content',
      'utf8',
    )

    await skillsInstallHandler(source, { projectDir: cwd })

    const installed = readFileSync(
      join(cwd, '.openclaude', 'skills', 'sample-skill', 'SKILL.md'),
      'utf8',
    )
    assert.equal(installed, 'existing skill content')
  })
})

test.serial('installs a registry skill by id from a local registry file', async () => {
  await withTempDir(async tempDir => {
    const cwd = join(tempDir, 'project')
    const sourceDir = writeSkillDir(join(tempDir, 'registry-source'))
    const registryPath = join(tempDir, 'registry.json')
    mkdirSync(cwd, { recursive: true })
    writeFileSync(
      registryPath,
      JSON.stringify([
        {
          id: 'gitlawb/sample-skill',
          name: 'sample-skill',
          title: 'Sample Skill',
          description: 'Sample skill used by install tests.',
          trust: 'official',
          version: '0.1.0',
          license: 'MIT',
          author: 'OpenClaude Tests',
          source: join(sourceDir, 'SKILL.md'),
          repo: 'https://github.com/Gitlawb/openclaude-skills',
          path: 'skills/sample-skill/SKILL.md',
          homepage: 'https://github.com/Gitlawb/openclaude-skills/tree/main/skills/sample-skill',
          sha256: sha256OfSkillSource(VALID_SKILL),
        },
      ]),
      'utf8',
    )

    await skillsInstallHandler('sample-skill', {
      projectDir: cwd,
      registry: registryPath,
    })

    const installedMetadata = JSON.parse(
      readFileSync(
        join(cwd, '.openclaude', 'skills', 'sample-skill', 'skill.json'),
        'utf8',
      ),
    ) as { trust: string; sha256: string }
    assert.equal(installedMetadata.trust, 'official')
    assert.equal(installedMetadata.sha256, sha256OfSkillSource(VALID_SKILL))
  })
})

test.serial('rejects path-like skill names before installing raw markdown', async () => {
  await withTempDir(async tempDir => {
    const cwd = join(tempDir, 'project')
    const sourceDir = join(tempDir, 'source')
    const sourceFile = join(sourceDir, 'SKILL.md')
    mkdirSync(sourceDir, { recursive: true })
    mkdirSync(cwd, { recursive: true })
    writeFileSync(sourceFile, PATH_TRAVERSAL_SKILL, 'utf8')

    await skillsInstallHandler(sourceFile, { projectDir: cwd })

    assert.equal(process.exitCode, 1)
    assert.equal(existsSync(join(cwd, '.openclaude', 'skills')), false)
  })
})

test.serial('rejects registry names that would escape the install root', async () => {
  await withTempDir(async tempDir => {
    const cwd = join(tempDir, 'project')
    const sourceDir = writeSkillDir(join(tempDir, 'registry-source'))
    const registryPath = join(tempDir, 'registry.json')
    mkdirSync(cwd, { recursive: true })
    writeFileSync(
      registryPath,
      JSON.stringify([
        {
          id: 'gitlawb/sample-skill',
          name: '../escape',
          title: 'Sample Skill',
          description: 'Sample skill used by install tests.',
          trust: 'official',
          version: '0.1.0',
          license: 'MIT',
          author: 'OpenClaude Tests',
          source: join(sourceDir, 'SKILL.md'),
          sha256: sha256OfSkillSource(VALID_SKILL),
        },
      ]),
      'utf8',
    )

    await skillsInstallHandler('sample-skill', {
      projectDir: cwd,
      registry: registryPath,
    })

    assert.equal(process.exitCode, 1)
    assert.equal(existsSync(join(cwd, '.openclaude', 'skills')), false)
  })
})
