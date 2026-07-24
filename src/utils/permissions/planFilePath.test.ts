import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { isPlanFilePath } from './filesystem.js'
import {
  encodeAgentIdForPlanFile,
  isPathWithinPlansDir,
  readAndMigrateLegacyPlan,
} from '../plans.js'

// isPlanFilePath gates two permission carve-outs in checkEditableInternalPath /
// checkReadableInternalPath: a plan file for the current session is auto-allowed
// for read AND for write with no prompt. The match must be exactly this
// session's plan, not any sibling that shares the slug as a name prefix.
const PLANS = join('/home/user', '.openclaude', 'plans')
const SLUG = 'brave-swift-otter'

test('accepts the main plan file', () => {
  expect(isPlanFilePath(PLANS, SLUG, join(PLANS, `${SLUG}.md`))).toBe(true)
})

test('accepts an agent plan file', () => {
  expect(
    isPlanFilePath(PLANS, SLUG, join(PLANS, `${SLUG}-agent-abc123.md`)),
  ).toBe(true)
})

test('rejects a sibling whose name merely begins with the slug', () => {
  // Before the fix these all passed a bare startsWith({plansDir}/{slug}) check
  // and were silently auto-allowed for read and un-prompted write.
  for (const name of [
    `${SLUG}nova.md`,
    `${SLUG}-other.md`,
    `${SLUG}2.md`,
  ]) {
    expect(isPlanFilePath(PLANS, SLUG, join(PLANS, name))).toBe(false)
  }
})

test('rejects a sibling directory whose name begins with the slug', () => {
  expect(
    isPlanFilePath(PLANS, SLUG, join(PLANS, `${SLUG}dir`, 'anything.md')),
  ).toBe(false)
})

test('rejects a lookalike agent directory', () => {
  // {slug}-agent-evil/ is a sibling directory, not an agent plan file. Matching
  // it would auto-allow unprompted reads and writes to everything beneath it.
  expect(
    isPlanFilePath(PLANS, SLUG, join(PLANS, `${SLUG}-agent-evil`, 'x.md')),
  ).toBe(false)
  expect(
    isPlanFilePath(
      PLANS,
      SLUG,
      join(PLANS, `${SLUG}-agent-a`, 'b', 'deep.md'),
    ),
  ).toBe(false)
})

test('rejects an agent plan file with an empty agent id', () => {
  // getPlanFilePath never emits this shape.
  expect(isPlanFilePath(PLANS, SLUG, join(PLANS, `${SLUG}-agent-.md`))).toBe(
    false,
  )
})

test('rejects a different session slug', () => {
  expect(isPlanFilePath(PLANS, SLUG, join(PLANS, 'calm-quiet-fox.md'))).toBe(
    false,
  )
})

test('rejects non-.md paths', () => {
  expect(isPlanFilePath(PLANS, SLUG, join(PLANS, `${SLUG}.txt`))).toBe(false)
  expect(isPlanFilePath(PLANS, SLUG, join(PLANS, `${SLUG}`))).toBe(false)
})

// Producer-to-predicate: TeamCreateTool accepts any nonblank team name and
// teammate spawning only strips `@` from the teammate name, so the agent id can
// legitimately carry a path separator. Every id a producer can emit has to
// survive the round trip, or that teammate loses access to its own plan file.
test('accepts every plan path the producer can emit for a real agent id', () => {
  for (const agentId of [
    'abc123',
    'writer@myteam',
    'writer@a/b',
    'writer@a\\b',
    'writer@a/b/c',
    'writer@100%',
  ]) {
    const emitted = join(
      PLANS,
      `${SLUG}-agent-${encodeAgentIdForPlanFile(agentId)}.md`,
    )
    expect(isPlanFilePath(PLANS, SLUG, emitted)).toBe(true)
  }
})

test('distinct agent ids never collide on one plan file', () => {
  // The escaping has to stay reversible: two teammates must not share a plan.
  const encoded = ['a/b', 'a%2Fb', 'a\\b', 'a%5Cb', 'a%25b'].map(
    encodeAgentIdForPlanFile,
  )
  expect(new Set(encoded).size).toBe(encoded.length)
})

test('normalizes traversal segments before matching', () => {
  // A path that resolves outside the plans dir must not match.
  expect(
    isPlanFilePath(PLANS, SLUG, join(PLANS, '..', 'evil', `${SLUG}.md`)),
  ).toBe(false)
})

describe('legacy plan file recovery', () => {
  // Escaping changed the pathname for teammates whose id already contained a
  // separator, and every reader now builds the escaped name. Without recovery
  // an existing plan reads as missing on upgrade and a second file is created
  // beside it, silently orphaning the teammate's work.
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'planmigrate-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test('reads a plan written under the unescaped name and moves it', () => {
    const legacyDir = join(dir, `${SLUG}-agent-writer@a`)
    mkdirSync(legacyDir, { recursive: true })
    const legacy = join(legacyDir, 'b.md')
    const escaped = join(
      dir,
      `${SLUG}-agent-${encodeAgentIdForPlanFile('writer@a/b')}.md`,
    )
    writeFileSync(legacy, 'the plan')

    expect(readAndMigrateLegacyPlan(legacy, escaped)).toBe('the plan')
    // Moved, not copied: the escaped name is the one the permission carve-out
    // recognizes, so leaving it behind would keep prompting on every write.
    expect(existsSync(escaped)).toBe(true)
    expect(existsSync(legacy)).toBe(false)
    expect(readFileSync(escaped, 'utf-8')).toBe('the plan')
    // And the migrated path is one the predicate accepts.
    expect(isPlanFilePath(dir, SLUG, escaped)).toBe(true)
  })

  test('returns null when there is no legacy file', () => {
    const escaped = join(dir, `${SLUG}-agent-writer%2Fb.md`)
    expect(
      readAndMigrateLegacyPlan(join(dir, `${SLUG}-agent-nothing.md`), escaped),
    ).toBeNull()
  })

  test('confines the legacy lookup to the plans directory', () => {
    // The legacy path is built from the RAW agent id, so a traversal-shaped
    // team/agent name can collapse to a path outside plansDir. Recovery must
    // refuse it before reading + renaming, or it would move an arbitrary file.
    const plansDir = join(dir, 'plans')
    for (const agentId of [
      '../../../etc/passwd',
      'x/../../../../etc/passwd',
      '../../../../root/.ssh/authorized_keys',
      'a/../../..//tmp/evil',
    ]) {
      const legacy = join(plansDir, `${SLUG}-agent-${agentId}.md`)
      // Each collapses to a path outside plansDir; recovery must refuse it.
      expect(isPathWithinPlansDir(legacy, plansDir)).toBe(false)
    }

    // Every id a producer actually emits keeps the legacy path inside plansDir:
    // the `/` lands a level deeper, not outside.
    for (const agentId of ['abc123', 'writer@myteam', 'writer@a/b']) {
      const legacy = join(plansDir, `${SLUG}-agent-${agentId}.md`)
      expect(isPathWithinPlansDir(legacy, plansDir)).toBe(true)
    }
  })

  test('does nothing when the id needed no escaping', () => {
    // The overwhelmingly common case: both names are identical, so there is no
    // legacy file to look for and no move to make.
    const path = join(dir, `${SLUG}-agent-abc123.md`)
    writeFileSync(path, 'plan')
    expect(readAndMigrateLegacyPlan(path, path)).toBeNull()
    expect(existsSync(path)).toBe(true)
  })
})
