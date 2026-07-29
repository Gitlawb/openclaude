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

import type { AgentId } from 'src/types/ids.js'

import { getSessionId } from '../../bootstrap/state.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import { isPlanFilePath } from './filesystem.js'
import {
  AGENT_PLANS_SUBDIR,
  encodeAgentIdForPlanFile,
  getPlan,
  getPlansDirectory,
  isPathWithinPlansDir,
  readAndMigrateLegacyPlan,
  readLegacyUnescapedPlan,
  setPlanSlug,
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

test('accepts an agent plan file in the agents subdirectory', () => {
  expect(
    isPlanFilePath(
      PLANS,
      SLUG,
      join(PLANS, AGENT_PLANS_SUBDIR, `${SLUG}-agent-abc123.md`),
    ),
  ).toBe(true)
})

test('rejects a legacy flat agent plan path (agent plans now live in the subdir)', () => {
  // getPlanFilePath no longer emits agent plans directly under plansDir, so the
  // carve-out must not auto-allow that shape -- a legacy file is only ever
  // touched by recovery, which migrates it into the subdir.
  expect(
    isPlanFilePath(PLANS, SLUG, join(PLANS, `${SLUG}-agent-abc123.md`)),
  ).toBe(false)
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
  // {subdir}/{slug}-agent-evil/ is a sibling directory, not an agent plan file.
  // Matching it would auto-allow unprompted reads and writes beneath it.
  const sub = join(PLANS, AGENT_PLANS_SUBDIR)
  expect(
    isPlanFilePath(PLANS, SLUG, join(sub, `${SLUG}-agent-evil`, 'x.md')),
  ).toBe(false)
  expect(
    isPlanFilePath(PLANS, SLUG, join(sub, `${SLUG}-agent-a`, 'b', 'deep.md')),
  ).toBe(false)
})

test('rejects an agent plan file with an empty agent id', () => {
  // getPlanFilePath never emits this shape.
  expect(
    isPlanFilePath(
      PLANS,
      SLUG,
      join(PLANS, AGENT_PLANS_SUBDIR, `${SLUG}-agent-.md`),
    ),
  ).toBe(false)
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
      AGENT_PLANS_SUBDIR,
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
      AGENT_PLANS_SUBDIR,
      `${SLUG}-agent-${encodeAgentIdForPlanFile('writer@a/b')}.md`,
    )
    mkdirSync(join(dir, AGENT_PLANS_SUBDIR), { recursive: true })
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

  test('does not overwrite a plan already at the escaped path (no-clobber)', () => {
    const legacy = join(dir, `${SLUG}-agent-writer@team.md`)
    const escaped = join(dir, AGENT_PLANS_SUBDIR, `${SLUG}-agent-fresh.md`)
    mkdirSync(join(dir, AGENT_PLANS_SUBDIR), { recursive: true })
    writeFileSync(legacy, 'legacy plan')
    writeFileSync(escaped, 'live plan')

    // The legacy contents come back, but the live plan at the escaped path is
    // left intact rather than clobbered by the rename.
    expect(readAndMigrateLegacyPlan(legacy, escaped)).toBe('legacy plan')
    expect(readFileSync(escaped, 'utf-8')).toBe('live plan')
    expect(existsSync(legacy)).toBe(true)
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

  // Exercise the guard through readLegacyUnescapedPlan itself (not just
  // isPathWithinPlansDir in isolation), so a future regression that drops the
  // check inside the recovery flow is caught.
  test('readLegacyUnescapedPlan refuses traversal-shaped ids and touches nothing', () => {
    const plansDir = join(dir, 'plans')
    mkdirSync(plansDir, { recursive: true })
    // A file the traversal ids would resolve onto if the guard were missing.
    const victim = join(plansDir, `${SLUG}.md`)
    writeFileSync(victim, 'main plan')
    const escaped = join(
      plansDir,
      AGENT_PLANS_SUBDIR,
      `${SLUG}-agent-x.md`,
    )

    for (const agentId of [
      `writer@a/../${SLUG}`,
      `writer@a/../${SLUG}-agent-victim`,
      '../../../etc/passwd',
      'a/../../..//tmp/evil',
    ]) {
      expect(
        readLegacyUnescapedPlan(agentId as AgentId, escaped, plansDir, SLUG),
      ).toBeNull()
    }

    // Nothing was read into a migration or renamed: the victim survives and no
    // escaped file was created.
    expect(readFileSync(victim, 'utf-8')).toBe('main plan')
    expect(existsSync(escaped)).toBe(false)
  })

  test('readLegacyUnescapedPlan recovers a legitimate legacy plan into the subdir', () => {
    const plansDir = join(dir, 'plans')
    mkdirSync(join(plansDir, AGENT_PLANS_SUBDIR), { recursive: true })
    const legacy = join(plansDir, `${SLUG}-agent-writer@team.md`)
    writeFileSync(legacy, 'legacy body')
    const escaped = join(
      plansDir,
      AGENT_PLANS_SUBDIR,
      `${SLUG}-agent-writer@team.md`,
    )

    expect(readLegacyUnescapedPlan('writer@team' as AgentId, escaped, plansDir, SLUG)).toBe(
      'legacy body',
    )
    expect(existsSync(escaped)).toBe(true)
    expect(existsSync(legacy)).toBe(false)
  })

  // Wire-through coverage: the whole user-visible fix is getPlan() falling back
  // to recovery on ENOENT. Drive the real getPlan() (not the helper) so a
  // regression in that branch can't hide behind green helper tests.
  test('getPlan recovers a legacy plan on ENOENT and migrates it into the subdir', async () => {
    await acquireSharedMutationLock('utils/permissions/planFilePath.test.ts')
    const savedCfg = process.env.OPENCLAUDE_CONFIG_DIR
    const configDir = mkdtempSync(join(tmpdir(), 'plancfg-'))
    process.env.OPENCLAUDE_CONFIG_DIR = configDir
    // getPlansDirectory is memoized; clear it so it recomputes under the temp
    // config dir, and again on teardown so later tests are unaffected.
    ;(getPlansDirectory as unknown as { cache: Map<string, string> }).cache.clear()
    try {
      const plansDir = getPlansDirectory()
      setPlanSlug(getSessionId(), SLUG)
      // A pre-escape legacy plan for an id that needs escaping, at the flat root.
      const legacy = join(plansDir, `${SLUG}-agent-writer@team.md`)
      writeFileSync(legacy, 'legacy body')

      // getPlan builds the escaped subdir path, misses (ENOENT), and recovers.
      expect(getPlan('writer@team' as AgentId)).toBe('legacy body')

      const escaped = join(
        plansDir,
        AGENT_PLANS_SUBDIR,
        `${SLUG}-agent-writer@team.md`,
      )
      expect(existsSync(escaped)).toBe(true)
      expect(existsSync(legacy)).toBe(false)
    } finally {
      if (savedCfg === undefined) {
        delete process.env.OPENCLAUDE_CONFIG_DIR
      } else {
        process.env.OPENCLAUDE_CONFIG_DIR = savedCfg
      }
      ;(
        getPlansDirectory as unknown as { cache: Map<string, string> }
      ).cache.clear()
      rmSync(configDir, { recursive: true, force: true })
      releaseSharedMutationLock()
    }
  })
})
