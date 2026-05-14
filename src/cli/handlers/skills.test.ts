import assert from 'node:assert/strict'
import test from 'node:test'

import type { Command } from '../../types/command.js'
import {
  formatSkillsListForDisplay,
  formatSkillsListJson,
} from './skillsListFormat.ts'

type SkillCommand = Command & { type: 'prompt' }

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
