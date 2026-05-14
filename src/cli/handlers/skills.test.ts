import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'bun:test'

import type { Command } from '../../types/command.js'
import { skillsInstallHandler } from './skillsInstall.ts'
import {
  formatSkillsListForDisplay,
  formatSkillsListJson,
} from './skillsListFormat.ts'

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
      ),
      skill('debug', 'Enable debug logging for this session and help diagnose issues.'),
      skill(
        'loop',
        'Run a prompt on a fixed interval or dynamically reschedule it, including bare maintenance-mode loops.',
      ),
      skill(
        'simplify',
        'Review changed code for reuse, quality, and efficiency, then fix any issues found.',
      ),
      skill(
        'update-config',
        'Use this skill to configure the Claude Code harness via settings.json. Automated behaviors require hooks.',
      ),
    ],
    80,
  )

  assert.match(output, /^Skills: 5 enabled/)
  assert.match(output, /Name\s+Status\s+Source\s+Description/)
  assert.doesNotMatch(output, /source: bundled \| trust:/)
  assert.match(output, /batch\s+enabled\s+bundled\s+Research and plan/)
  assert.match(output, /update-config\s+enabled\s+bundled\s+Configure the Claude Code harness via/)
})

test('wraps description continuations under the Description column', () => {
  const output = formatSkillsListForDisplay(
    [
      skill(
        'batch',
        'Research and plan a large-scale change, then execute it in parallel across 5–30 isolated worktree agents that each open a PR.',
      ),
    ],
    70,
  )
  const lines = output.split('\n')
  const header = lines.find(line => line.includes('Description'))
  assert.ok(header)
  const descriptionColumn = header.indexOf('Description')
  const continuation = lines.find(line =>
    line.trim().startsWith('then execute'),
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

test('formats skills list json as machine-readable metadata', () => {
  const description = 'Full description should remain in JSON. Extra sentence stays.'
  const parsed = JSON.parse(
    formatSkillsListJson([skill('debug', description, 'projectSettings')]),
  ) as {
    enabledCount: number
    skills: Array<{ name: string; source: string; description: string }>
  }

  assert.equal(parsed.enabledCount, 1)
  assert.equal(parsed.skills[0]?.name, 'debug')
  assert.equal(parsed.skills[0]?.source, 'project')
  assert.equal(parsed.skills[0]?.description, description)
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
