import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, test } from 'bun:test'

import { skillsInstallHandler } from './skillsInstall.ts'

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

let tempDir = ''

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'openclaude-skill-install-test-'))
  process.exitCode = undefined
})

afterEach(() => {
  process.exitCode = 0
  rmSync(tempDir, { recursive: true, force: true })
})

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

test.serial('installs a local skill directory into project skills by default', async () => {
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

test.serial('refuses to overwrite installed skills without --force', async () => {
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

test.serial('installs a registry skill by id from a local registry file', async () => {
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
