import { describe, expect, it } from 'bun:test'
import { Command } from '@commander-js/extra-typings'
import { applyMainOptions } from '../mainCliOptions.js'
import {
  SKILLS_GLOBAL_BOOLEAN_FLAGS,
  SKILLS_PROMPT_MODE_FLAGS,
} from './skillsBooleanFlags.js'

// Absent from this build's registrations because scripts/build.ts compiles their
// features out. Listed so the arity check's escape hatch cannot quietly widen.
const FEATURE_GATED_FLAGS = [
  '--assistant',
  '--brief',
  '--enable-auto-mode',
  '--hard-fail',
  '--proactive',
]

describe('skills flag sets', () => {
  it('keeps the boolean and prompt-mode sets disjoint', () => {
    // getSkillsCliArgs tests the boolean set FIRST, so a flag in both is
    // silently skipped and never reaches its prompt-mode handling. That is not
    // hypothetical: `--continue` was added to the boolean set because it is
    // value-less — the obvious half of that set's contract — and it broke
    // `openclaude --continue skills list`, which must resume the prior
    // conversation with `skills list` as its prompt rather than dispatch to the
    // skills manager.
    const overlap = [...SKILLS_PROMPT_MODE_FLAGS].filter(flag =>
      SKILLS_GLOBAL_BOOLEAN_FLAGS.has(flag),
    )
    expect(overlap).toEqual([])
  })

  it('lists no value-taking flag in the boolean set', () => {
    // Arity is asked of commander, not hand-listed, so this tracks
    // applyMainOptions automatically as options are added or change shape.
    //
    // The earlier version of this test filtered on membership in
    // SKILLS_PROMPT_MODE_FLAGS, which the test above already proves empty — so
    // it was a vacuous duplicate and `--model` in the boolean set passed both.
    // This half of the contract has no other guard: entries are skipped WITHOUT
    // consuming a following token, so a value-taking flag leaves its value
    // behind as a stray operand.
    // Keyed by BOTH spellings: commander stores a dual-long registration's first
    // flag as `.short`, so `--yolo` (the alias this PR adds) was absent from a
    // long-only map and fell through the feature-gated escape hatch below —
    // unchecked by the very test meant to cover it.
    const registered = new Map(
      applyMainOptions(new Command()).options.flatMap(option =>
        [option.long, option.short]
          .filter((name): name is string => Boolean(name))
          .map(name => [name, option] as const),
      ),
    )

    const valueTaking = [...SKILLS_GLOBAL_BOOLEAN_FLAGS].filter(flag => {
      // `--debug` is the documented exception: its value is optional, and
      // consuming it would swallow the subcommand instead (see the module doc).
      if (flag === '--debug') return false
      const option = registered.get(flag)
      // Feature-gated flags are absent from this build's registrations; they
      // cannot be checked here and are value-less by inspection. Kept narrow on
      // purpose — this escape hatch previously swallowed `--yolo` too.
      if (option === undefined) {
        expect(FEATURE_GATED_FLAGS).toContain(flag)
        return false
      }
      return option.required || option.optional
    })

    expect(valueTaking).toEqual([])
  })
})
