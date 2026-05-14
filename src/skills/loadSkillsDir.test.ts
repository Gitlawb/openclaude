import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'
import {
  clearDynamicSkills,
  clearSkillCaches,
  discoverSkillDirsForPaths,
  getSkillDirCommands,
} from './loadSkillsDir.ts'

function writeSkill(
  rootDir: string,
  skillPath: string,
  options?: { configDirName?: '.claude' | '.openclaude'; description?: string },
): void {
  const skillDir = join(
    rootDir,
    options?.configDirName ?? '.claude',
    'skills',
    ...skillPath.split('/'),
  )
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    `---\ndescription: ${options?.description ?? skillPath}\n---\n# ${skillPath}\n`,
    'utf8',
  )
}

function writeUserSkill(
  configDir: string,
  skillPath: string,
  description = skillPath,
): void {
  const skillDir = join(configDir, 'skills', ...skillPath.split('/'))
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    `---\ndescription: ${description}\n---\n# ${skillPath}\n`,
    'utf8',
  )
}

test('loads flat and nested skills with colon namespaces', async () => {
  await acquireSharedMutationLock('loadSkillsDir.test.ts')
  const configDir = mkdtempSync(join(tmpdir(), 'openclaude-skills-'))
  const cwd = join(configDir, 'workspace')
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR

  try {
    mkdirSync(cwd, { recursive: true })
    writeSkill(configDir, 'flat-skill')
    writeSkill(configDir, 'git/commit')
    writeSkill(configDir, 'frontend/react/form')

    process.env.CLAUDE_CONFIG_DIR = configDir
    clearSkillCaches()

    const skills = await getSkillDirCommands(cwd)
    const promptSkills = skills.filter(skill => skill.type === 'prompt')
    const skillNames = promptSkills.map(skill => skill.name).sort()

    assert.deepEqual(skillNames, [
      'flat-skill',
      'frontend:react:form',
      'git:commit',
    ])

    const nestedSkill = promptSkills.find(skill => skill.name === 'git:commit')
    assert.ok(nestedSkill)
    assert.equal(nestedSkill.skillRoot, join(configDir, '.claude', 'skills', 'git', 'commit'))

    const deepSkill = promptSkills.find(
      skill => skill.name === 'frontend:react:form',
    )
    assert.ok(deepSkill)
    assert.equal(
      deepSkill.skillRoot,
      join(configDir, '.claude', 'skills', 'frontend', 'react', 'form'),
    )
  } finally {
    try {
      if (originalConfigDir === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR
      } else {
        process.env.CLAUDE_CONFIG_DIR = originalConfigDir
      }
      clearSkillCaches()
      rmSync(configDir, { recursive: true, force: true })
    } finally {
      releaseSharedMutationLock()
    }
  }
})

test('prefers .openclaude project skills over legacy .claude skills with the same name', async () => {
  const configDir = mkdtempSync(join(tmpdir(), 'openclaude-skills-'))
  const cwd = join(configDir, 'workspace')
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR

  try {
    mkdirSync(cwd, { recursive: true })
    writeSkill(cwd, 'shared', {
      configDirName: '.claude',
      description: 'legacy project skill',
    })
    writeSkill(cwd, 'shared', {
      configDirName: '.openclaude',
      description: 'native project skill',
    })

    process.env.CLAUDE_CONFIG_DIR = configDir
    clearSkillCaches()

    const skills = await getSkillDirCommands(cwd)
    const sharedSkills = skills.filter(
      skill => skill.type === 'prompt' && skill.name === 'shared',
    )

    assert.equal(sharedSkills.length, 2)
    assert.equal(sharedSkills[0]?.type, 'prompt')
    assert.equal(sharedSkills[0]?.description, 'native project skill')
    assert.match(sharedSkills[0]?.skillRoot ?? '', /\.openclaude/)
  } finally {
    if (originalConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR
    } else {
      process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    }
    clearSkillCaches()
    rmSync(configDir, { recursive: true, force: true })
  }
})

test('project skills are ordered before user skills with the same name', async () => {
  const configDir = mkdtempSync(join(tmpdir(), 'openclaude-skills-'))
  const cwd = join(configDir, 'workspace')
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR

  try {
    mkdirSync(cwd, { recursive: true })
    writeUserSkill(configDir, 'shared', 'user skill')
    writeSkill(cwd, 'shared', {
      configDirName: '.openclaude',
      description: 'project skill',
    })

    process.env.CLAUDE_CONFIG_DIR = configDir
    clearSkillCaches()

    const skills = await getSkillDirCommands(cwd)
    const sharedSkills = skills.filter(
      skill => skill.type === 'prompt' && skill.name === 'shared',
    )

    assert.equal(sharedSkills.length, 2)
    assert.equal(sharedSkills[0]?.type, 'prompt')
    assert.equal(sharedSkills[0]?.description, 'project skill')
    assert.equal(sharedSkills[0]?.source, 'projectSettings')
  } finally {
    if (originalConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR
    } else {
      process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    }
    clearSkillCaches()
    rmSync(configDir, { recursive: true, force: true })
  }
})

test('dynamic discovery checks .openclaude skill directories', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'openclaude-skills-'))
  const cwd = join(rootDir, 'workspace')
  const featureDir = join(cwd, 'src', 'feature')

  try {
    mkdirSync(featureDir, { recursive: true })
    writeSkill(featureDir, 'feature-skill', {
      configDirName: '.openclaude',
    })

    clearDynamicSkills()

    const dirs = await discoverSkillDirsForPaths(
      [join(featureDir, 'file.ts')],
      cwd,
    )

    assert.deepEqual(dirs, [join(featureDir, '.openclaude', 'skills')])
  } finally {
    clearDynamicSkills()
    rmSync(rootDir, { recursive: true, force: true })
  }
})
