import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'bun:test'

import {
  enableUserAndProjectSettingSources,
  restoreSettingState,
} from '../test/settingSourceState.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'
import type { Command } from '../types/command.ts'
import {
  getClaudeConfigHomeDir,
  getClaudeConfigHomeDirOverrideForTesting,
  setClaudeConfigHomeDirForTesting,
} from '../utils/envUtils.ts'
import {
  getFsImplementation,
  setFsImplementation,
} from '../utils/fsOperations.ts'
import { resetSettingsCache } from '../utils/settings/settingsCache.ts'
import {
  clearDynamicSkills,
  clearSkillCaches,
  getSkillDirCommands,
  getProjectSkillsPaths,
} from './loadSkillsDir.ts'

function writeSkill(
  rootDir: string,
  skillPath: string,
  options?: { configDirName?: '.claude' | '.openclaude'; description?: string },
): void {
  const skillDir = join(
    rootDir,
    options?.configDirName ?? '.openclaude',
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

function isPromptSkillNamed(
  skill: Command,
  name: string,
): skill is Extract<Command, { type: 'prompt' }> {
  return (
    skill.type === 'prompt' &&
    skill.name === name
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

function clearSkillAndConfigCaches(): void {
  clearSkillCaches()
  getClaudeConfigHomeDir.cache?.clear?.()
  resetSettingsCache()
}

function setRealFilesystemForTest(): ReturnType<typeof getFsImplementation> {
  const originalFs = getFsImplementation()
  setFsImplementation({
    ...originalFs,
    stat: async path => statSync(path),
    readdir: async path => readdirSync(path, { withFileTypes: true }),
    readFile: async (path, options) => readFileSync(path, options),
  })
  return originalFs
}

function setConfigDirEnv(configDir: string): void {
  setClaudeConfigHomeDirForTesting(undefined)
  process.env.OPENCLAUDE_CONFIG_DIR = configDir
  delete process.env.CLAUDE_CONFIG_DIR
}

function restoreConfigDirEnv(original: {
  openClaudeConfigDir: string | undefined
  claudeConfigDir: string | undefined
  configHomeOverride: string | undefined
}): void {
  setClaudeConfigHomeDirForTesting(original.configHomeOverride)

  if (original.openClaudeConfigDir === undefined) {
    delete process.env.OPENCLAUDE_CONFIG_DIR
  } else {
    process.env.OPENCLAUDE_CONFIG_DIR = original.openClaudeConfigDir
  }

  if (original.claudeConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = original.claudeConfigDir
  }
}

test.serial('loads flat and nested skills with colon namespaces', async () => {
  await acquireSharedMutationLock('loadSkillsDir.test.ts')
  const configDir = mkdtempSync(join(tmpdir(), 'openclaude-skills-'))
  const cwd = join(configDir, 'workspace')
  const originalConfigDir = {
    openClaudeConfigDir: process.env.OPENCLAUDE_CONFIG_DIR,
    claudeConfigDir: process.env.CLAUDE_CONFIG_DIR,
    configHomeOverride: getClaudeConfigHomeDirOverrideForTesting(),
  }
  const originalSettingsState = enableUserAndProjectSettingSources()
  const originalFs = setRealFilesystemForTest()

  try {
    mkdirSync(cwd, { recursive: true })
    writeSkill(configDir, 'flat-skill')
    writeSkill(configDir, 'git/commit')
    writeSkill(configDir, 'frontend/react/form')

    setConfigDirEnv(configDir)
    clearSkillAndConfigCaches()

    const skills = await getSkillDirCommands(cwd)
    const fixtureSkillsRoot = join(configDir, '.openclaude', 'skills')
    const promptSkills = skills.filter(
      (
        skill,
      ): skill is Extract<(typeof skills)[number], { type: 'prompt' }> & {
        skillRoot: string
      } =>
        skill.type === 'prompt' &&
        skill.skillRoot?.startsWith(fixtureSkillsRoot) === true,
    )
    const skillNames = promptSkills.map(skill => skill.name).sort()

    assert.deepEqual(skillNames, [
      'flat-skill',
      'frontend:react:form',
      'git:commit',
    ])

    const nestedSkill = promptSkills.find(skill => skill.name === 'git:commit')
    assert.ok(nestedSkill)
    assert.equal(nestedSkill.skillRoot, join(configDir, '.openclaude', 'skills', 'git', 'commit'))

    const deepSkill = promptSkills.find(
      skill => skill.name === 'frontend:react:form',
    )
    assert.ok(deepSkill)
    assert.equal(
      deepSkill.skillRoot,
      join(configDir, '.openclaude', 'skills', 'frontend', 'react', 'form'),
    )
  } finally {
    try {
      restoreConfigDirEnv(originalConfigDir)
      setFsImplementation(originalFs)
      restoreSettingState(originalSettingsState)
      clearSkillAndConfigCaches()
      rmSync(configDir, { recursive: true, force: true })
    } finally {
      releaseSharedMutationLock()
    }
  }
})

test.serial('ignores legacy .claude project skills when .openclaude skills exist', async () => {
  await acquireSharedMutationLock('loadSkillsDir.test.ts')
  const configDir = mkdtempSync(join(tmpdir(), 'openclaude-skills-'))
  const cwd = join(configDir, 'workspace')
  const originalConfigDir = {
    openClaudeConfigDir: process.env.OPENCLAUDE_CONFIG_DIR,
    claudeConfigDir: process.env.CLAUDE_CONFIG_DIR,
    configHomeOverride: getClaudeConfigHomeDirOverrideForTesting(),
  }
  const originalSettingsState = enableUserAndProjectSettingSources()
  const originalFs = setRealFilesystemForTest()

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

    setConfigDirEnv(configDir)
    clearSkillAndConfigCaches()

    const skills = await getSkillDirCommands(cwd)
    const sharedSkills = skills.filter(
      skill => skill.type === 'prompt' && skill.name === 'shared',
    )

    assert.equal(sharedSkills.length, 1)
    assert.equal(sharedSkills[0]?.type, 'prompt')
    assert.equal(sharedSkills[0]?.description, 'native project skill')
    assert.match(sharedSkills[0]?.skillRoot ?? '', /\.openclaude/)
  } finally {
    restoreConfigDirEnv(originalConfigDir)
    setFsImplementation(originalFs)
    try {
      clearSkillAndConfigCaches()
      restoreSettingState(originalSettingsState)
      rmSync(configDir, { recursive: true, force: true })
    } finally {
      releaseSharedMutationLock()
    }
  }
})

test.serial('loads persisted registry trust metadata from skill.json', async () => {
  await acquireSharedMutationLock('loadSkillsDir.test.ts')
  const configDir = mkdtempSync(join(tmpdir(), 'openclaude-skills-'))
  const cwd = join(configDir, 'workspace')
  const originalConfigDir = {
    openClaudeConfigDir: process.env.OPENCLAUDE_CONFIG_DIR,
    claudeConfigDir: process.env.CLAUDE_CONFIG_DIR,
    configHomeOverride: getClaudeConfigHomeDirOverrideForTesting(),
  }
  const originalSettingsState = enableUserAndProjectSettingSources()
  const originalFs = setRealFilesystemForTest()

  try {
    mkdirSync(cwd, { recursive: true })
    const skillDir = join(cwd, '.openclaude', 'skills', 'registry-skill')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---\ndescription: Registry skill\n---\n# Registry Skill\n`,
      'utf8',
    )
    writeFileSync(
      join(skillDir, 'skill.json'),
      JSON.stringify({ trust: 'official' }),
      'utf8',
    )

    setConfigDirEnv(configDir)
    clearSkillAndConfigCaches()

    const registrySkill = (await getSkillDirCommands(cwd)).find(skill =>
      isPromptSkillNamed(skill, 'registry-skill'),
    )

    assert.equal(registrySkill?.skillTrust, 'official')
  } finally {
    try {
      restoreConfigDirEnv(originalConfigDir)
      setFsImplementation(originalFs)
      restoreSettingState(originalSettingsState)
      clearSkillAndConfigCaches()
      rmSync(configDir, { recursive: true, force: true })
    } finally {
      releaseSharedMutationLock()
    }
  }
})

test.serial('project skills are ordered before user skills with the same name', async () => {
  await acquireSharedMutationLock('loadSkillsDir.test.ts')
  const configDir = mkdtempSync(join(tmpdir(), 'openclaude-skills-'))
  const cwd = join(configDir, 'workspace')
  const originalConfigDir = {
    openClaudeConfigDir: process.env.OPENCLAUDE_CONFIG_DIR,
    claudeConfigDir: process.env.CLAUDE_CONFIG_DIR,
    configHomeOverride: getClaudeConfigHomeDirOverrideForTesting(),
  }
  const originalSettingsState = enableUserAndProjectSettingSources()
  const originalFs = setRealFilesystemForTest()

  try {
    mkdirSync(cwd, { recursive: true })
    setConfigDirEnv(configDir)
    const userConfigDir = getClaudeConfigHomeDir()
    writeUserSkill(userConfigDir, 'shared', 'user skill')
    writeSkill(cwd, 'shared', {
      configDirName: '.openclaude',
      description: 'project skill',
    })

    clearSkillAndConfigCaches()

    const sharedSkills = (await getSkillDirCommands(cwd))
      .filter(skill => isPromptSkillNamed(skill, 'shared'))
      .map(skill => ({
        description: skill.description,
        source: skill.source,
        skillRoot: skill.skillRoot,
      }))

    assert.deepEqual(sharedSkills, [
      {
        description: 'project skill',
        source: 'projectSettings',
        skillRoot: join(cwd, '.openclaude', 'skills', 'shared'),
      },
      {
        description: 'user skill',
        source: 'userSettings',
        skillRoot: join(userConfigDir, 'skills', 'shared'),
      },
    ])
  } finally {
    try {
      restoreConfigDirEnv(originalConfigDir)
      setFsImplementation(originalFs)
      restoreSettingState(originalSettingsState)
      clearSkillAndConfigCaches()
      rmSync(configDir, { recursive: true, force: true })
    } finally {
      releaseSharedMutationLock()
    }
  }
})

test.serial('dynamic discovery checks .openclaude skill directories', async () => {
  await acquireSharedMutationLock('loadSkillsDir.test.ts')
  const originalFs = setRealFilesystemForTest()
  const originalArgv = [...process.argv]
  const originalClaudeCodeSimple = process.env.CLAUDE_CODE_SIMPLE
  const rootDir = mkdtempSync(join(tmpdir(), 'openclaude-skills-'))
  const cwd = join(rootDir, 'workspace')
  const featureDir = join(cwd, 'src', 'feature')

  try {
    process.argv = process.argv.filter(arg => arg !== '--bare')
    delete process.env.CLAUDE_CODE_SIMPLE
    mkdirSync(featureDir, { recursive: true })
    execFileSync('git', ['init'], { cwd, stdio: 'ignore' })
    writeSkill(featureDir, 'feature-skill', {
      configDirName: '.openclaude',
    })

    assert.deepEqual(getProjectSkillsPaths(featureDir), [
      join(featureDir, '.openclaude', 'skills'),
    ])
  } finally {
    try {
      process.argv = originalArgv
      if (originalClaudeCodeSimple === undefined) {
        delete process.env.CLAUDE_CODE_SIMPLE
      } else {
        process.env.CLAUDE_CODE_SIMPLE = originalClaudeCodeSimple
      }
      setFsImplementation(originalFs)
      clearDynamicSkills()
      rmSync(rootDir, { recursive: true, force: true })
    } finally {
      releaseSharedMutationLock()
    }
  }
})
