import { describe, expect, test } from 'bun:test'
import type { PluginManifest } from './schemas.js'
import { buildDirectSkillAliases } from './pluginSkillAliases.js'

const optInManifest: PluginManifest = {
  name: 'compound-engineering',
  directSkillAliases: true,
}

describe('buildDirectSkillAliases', () => {
  test('uses skill name and aliases frontmatter when the plugin opts in', () => {
    expect(
      buildDirectSkillAliases({
        commandName: 'compound-engineering:ce-plan',
        displayName: 'ce-plan',
        frontmatter: { aliases: ['plan-with-ce'] },
        pluginManifest: optInManifest,
        isSkillCommand: true,
      }),
    ).toEqual(['ce-plan', 'plan-with-ce'])
  })

  test('ignores invalid alias metadata without dropping valid aliases', () => {
    expect(
      buildDirectSkillAliases({
        commandName: 'compound-engineering:ce-plan',
        displayName: '../bad',
        frontmatter: { aliases: ['valid_alias', 'bad alias'] },
        pluginManifest: optInManifest,
        isSkillCommand: true,
      }),
    ).toEqual(['valid_alias'])
  })

  test('requires plugin opt-in and a skill command', () => {
    expect(
      buildDirectSkillAliases({
        commandName: 'plugin:ce-plan',
        displayName: 'ce-plan',
        frontmatter: {},
        pluginManifest: { name: 'plugin' },
        isSkillCommand: true,
      }),
    ).toBeUndefined()
    expect(
      buildDirectSkillAliases({
        commandName: 'plugin:ce-plan',
        displayName: 'ce-plan',
        frontmatter: {},
        pluginManifest: optInManifest,
        isSkillCommand: false,
      }),
    ).toBeUndefined()
  })
})
