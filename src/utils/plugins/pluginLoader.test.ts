import { mkdtemp, mkdir, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { describe, expect, test } from 'bun:test'

import type { LoadedPlugin } from '../../types/plugin.js'
import {
  createPluginFromPath,
  mergePluginSources,
  resolveExistingPluginComponentPath,
  resolvePluginComponentPath,
} from './pluginLoader.js'

function marketplacePlugin(
  name: string,
  marketplace: string,
  enabled: boolean,
): LoadedPlugin {
  const pluginId = `${name}@${marketplace}`
  return {
    name,
    manifest: { name } as LoadedPlugin['manifest'],
    path: `/tmp/${pluginId}`,
    source: pluginId,
    repository: pluginId,
    enabled,
  }
}

describe('mergePluginSources', () => {
  test('keeps the enabled copy when duplicate marketplace plugins disagree on enabled state', () => {
    const enabledOfficial = marketplacePlugin(
      'frontend-design',
      'claude-plugins-official',
      true,
    )
    const disabledLegacy = marketplacePlugin(
      'frontend-design',
      'claude-code-plugins',
      false,
    )

    const result = mergePluginSources({
      session: [],
      marketplace: [disabledLegacy, enabledOfficial],
      builtin: [],
    })

    expect(result.plugins).toEqual([enabledOfficial])
    expect(result.errors).toEqual([])
  })

  test('keeps the later copy when duplicate marketplace plugins are both enabled', () => {
    const legacy = marketplacePlugin(
      'frontend-design',
      'claude-code-plugins',
      true,
    )
    const official = marketplacePlugin(
      'frontend-design',
      'claude-plugins-official',
      true,
    )

    const result = mergePluginSources({
      session: [],
      marketplace: [legacy, official],
      builtin: [],
    })

    expect(result.plugins).toEqual([official])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatchObject({
      type: 'generic-error',
      source: legacy.source,
      plugin: legacy.name,
    })
  })
})

async function createDirectoryLink(
  target: string,
  linkPath: string,
): Promise<void> {
  await symlink(
    target,
    linkPath,
    process.platform === 'win32' ? 'junction' : 'dir',
  )
}

describe('resolvePluginComponentPath', () => {
  test('keeps relative component paths inside the plugin directory', () => {
    const pluginRoot = resolve(tmpdir(), 'plugin')

    expect(resolvePluginComponentPath(pluginRoot, 'commands/build.md')).toBe(
      resolve(pluginRoot, 'commands/build.md'),
    )
  })

  test('rejects component paths that traverse outside the plugin directory', () => {
    expect(resolvePluginComponentPath('/tmp/plugin', '../secret.md')).toBeNull()
    expect(
      resolvePluginComponentPath('/tmp/plugin', 'commands/../../secret.md'),
    ).toBeNull()
  })

  test('rejects absolute component paths outside the plugin directory', () => {
    expect(resolvePluginComponentPath('/tmp/plugin', '/etc/passwd')).toBeNull()
  })

  test('rejects file symlink component paths whose real target escapes the plugin directory', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'plugin-paths-'))
    try {
      const pluginRoot = join(tempRoot, 'plugin')
      const commandsDir = join(pluginRoot, 'commands')
      const outsideFile = join(tempRoot, 'secret.md')
      const linkPath = join(commandsDir, 'link-to-secret.md')

      await mkdir(commandsDir, { recursive: true })
      await writeFile(outsideFile, '# secret\n')
      try {
        await symlink(outsideFile, linkPath)
      } catch {
        // Some Windows environments require elevated privileges for symlinks.
        return
      }

      await expect(
        resolveExistingPluginComponentPath(
          pluginRoot,
          'commands/link-to-secret.md',
        ),
      ).resolves.toMatchObject({
        fullPath: linkPath,
        exists: true,
        outOfBounds: true,
      })
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })

  test('rejects directory symlink skill paths whose SKILL.md real target escapes the plugin directory', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'plugin-paths-'))
    try {
      const pluginRoot = join(tempRoot, 'plugin')
      const skillsDir = join(pluginRoot, 'skills')
      const outsideSkillDir = join(tempRoot, 'outside-skill')
      const linkPath = join(skillsDir, 'linked-skill')
      const skillPath = join(linkPath, 'SKILL.md')

      await mkdir(skillsDir, { recursive: true })
      await mkdir(outsideSkillDir, { recursive: true })
      await writeFile(join(outsideSkillDir, 'SKILL.md'), '# escaped skill\n')
      await createDirectoryLink(outsideSkillDir, linkPath)

      await expect(
        resolveExistingPluginComponentPath(
          pluginRoot,
          'skills/linked-skill/SKILL.md',
        ),
      ).resolves.toMatchObject({
        fullPath: skillPath,
        exists: true,
        outOfBounds: true,
      })
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })

  test('rejects auto-detected component directories whose real targets escape the plugin directory', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'plugin-paths-'))
    try {
      const pluginRoot = join(tempRoot, 'plugin')
      await mkdir(pluginRoot, { recursive: true })

      const linkedDirectories = [
        'commands',
        'agents',
        'skills',
        'output-styles',
      ] as const
      for (const directory of linkedDirectories) {
        const outsideDirectory = join(tempRoot, `outside-${directory}`)
        await mkdir(outsideDirectory, { recursive: true })
        await createDirectoryLink(outsideDirectory, join(pluginRoot, directory))
      }

      const { plugin, errors } = await createPluginFromPath(
        pluginRoot,
        'test-source',
        true,
        'test-plugin',
      )

      expect(plugin.commandsPath).toBeUndefined()
      expect(plugin.agentsPath).toBeUndefined()
      expect(plugin.skillsPath).toBeUndefined()
      expect(plugin.outputStylesPath).toBeUndefined()
      expect(errors).toHaveLength(4)
      expect(errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'generic-error',
            error: expect.stringContaining(
              'Command directory commands resolves outside plugin directory',
            ),
          }),
          expect.objectContaining({
            type: 'generic-error',
            error: expect.stringContaining(
              'Agent directory agents resolves outside plugin directory',
            ),
          }),
          expect.objectContaining({
            type: 'generic-error',
            error: expect.stringContaining(
              'Skill directory skills resolves outside plugin directory',
            ),
          }),
          expect.objectContaining({
            type: 'generic-error',
            error: expect.stringContaining(
              'Output style directory output-styles resolves outside plugin directory',
            ),
          }),
        ]),
      )
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })
})
