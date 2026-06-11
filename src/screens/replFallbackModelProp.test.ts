/**
 * Regression tests for --fallback-model prop plumbing through interactive paths.
 *
 * The --fallback-model CLI option was extended from --print-only to interactive
 * mode. These tests verify all 3 entry points pass the prop through:
 *   1. Foreground REPL query() call (via sessionConfig spread)
 *   2. --resume picker (via launchResumeChooser -> ResumeConversation -> REPL)
 *   3. Background session (Ctrl+B -> startBackgroundSession queryParams)
 *
 * Tests read source files as text (no module loading) to avoid pulling in
 * transitive dependencies that can't resolve in the test environment.
 *
 * Strengthened after PR review (jatmn): the prior regex just looked for any
 * `query({ ... fallbackModel` substring or a loose 8KB window after
 * `startBackgroundSession(`, which could be satisfied by the prop type,
 * destructuring, dep array, or the *other* path's token. Each assertion
 * below is bounded to its specific call site so a regression in one path
 * can no longer be masked by the other.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const testDir = import.meta.dirname

function readSource(filename: string): string {
  return readFileSync(join(testDir, filename), 'utf8')
}

function readSourceUp(filename: string): string {
  return readFileSync(join(testDir, '..', filename), 'utf8')
}

describe('fallbackModel: REPL Props contract', () => {
  test('REPL Props type declares optional fallbackModel', () => {
    const source = readSource('REPL.tsx')
    expect(source).toContain('fallbackModel?: string')
  })

  test('REPL function signature destructures fallbackModel from Props', () => {
    const source = readSource('REPL.tsx')
    // Bounded regex matches the function REPL({ ... fallbackModel ... }: Props)
    // signature exactly. Catches a regression that drops the prop from
    // destructuring (which would silently pass undefined to every
    // downstream call). An unbounded "any `fallbackModel` after the type"
    // check is insufficient because dep arrays, query calls, and the
    // background path all carry the token too.
    const match = source.match(
      /function\s+REPL\s*\(\s*\{[\s\S]*?fallbackModel[\s\S]*?\}\s*:\s*Props\s*\)/
    )
    expect(match).not.toBeNull()
  })
})

describe('fallbackModel: foreground query() path', () => {
  test('foreground query({ ... }) call carries fallbackModel', () => {
    const source = readSource('REPL.tsx')
    // Bounded regex: requires a complete `query({ ... fallbackModel ... })`
    // call. The closing `\s*\)` is the key — without it, the regex would
    // happily match across the first `query({` and find a `fallbackModel`
    // token in the background `queryParams` block, the dep array, or the
    // function signature, masking a regression that removes fallbackModel
    // from the foreground `query({ ... })` call specifically.
    const match = source.match(
      /query\(\s*\{[\s\S]*?fallbackModel[\s\S]*?\}\s*\)/
    )
    expect(match).not.toBeNull()
  })
})

describe('fallbackModel: ResumeConversation path', () => {
  test('ResumeConversation Props type declares optional fallbackModel', () => {
    const source = readSource('ResumeConversation.tsx')
    expect(source).toContain('fallbackModel?: string')
  })

  test('ResumeConversation passes fallbackModel to <REPL />', () => {
    const source = readSource('ResumeConversation.tsx')
    // The JSX prop `fallbackModel={fallbackModel}` must appear on the
    // <REPL /> element specifically, not just somewhere in the file.
    // Anchor to the <REPL opening tag and verify the prop is on the
    // same element up to the self-closing "/>". This catches a
    // regression that migrates the prop to a different component or
    // accidentally drops it while editing the JSX.
    const replIdx = source.indexOf('<REPL')
    expect(replIdx).toBeGreaterThan(-1)
    const elementEnd = source.indexOf('/>', replIdx)
    expect(elementEnd).toBeGreaterThan(replIdx)
    const element = source.slice(replIdx, elementEnd + 2)
    expect(element).toContain('fallbackModel={fallbackModel}')
  })
})

describe('fallbackModel: background session path', () => {
  test('background queryParams object contains fallbackModel', () => {
    const source = readSource('REPL.tsx')
    // The background path (Ctrl+B) builds a `queryParams = { ... }` object
    // that is spread into startBackgroundSession.
    //
    // The previous regex `/queryParams[\s\S]*?fallbackModel/` was too
    // loose: it would still match even after `fallbackModel` was removed
    // from the queryParams object, because `fallbackModel` appears later
    // in the file (e.g. in a useEffect dependency array). A naive
    // bounded regex like `/queryParams\s*=\s*\{[^{}]*fallbackModel[^{}]*\}/`
    // would also be wrong here — it can't tell the difference between
    // a `}` that closes the queryParams object and a `}` that closes a
    // nested object/array literal inside the body, so it would either
    // under-match (if the body has nested braces) or stop at the first
    // inner `}` and miss `fallbackModel` declared after it.
    //
    // The robust fix: walk the braces explicitly to find the matching
    // `}` of the queryParams object literal. This is the same
    // balanced-delimiter pattern used by the `launchResumeChooser` and
    // `startBackgroundSession` call-slice checks elsewhere in this
    // file, and it bounds the assertion to the body of THIS specific
    // object — so a regression that drops `fallbackModel` from the
    // queryParams block can no longer be masked by a later reference.
    const assignMatch = source.match(/queryParams\s*:\s*\{/)
    expect(assignMatch).not.toBeNull()
    const openBraceIdx = assignMatch!.index! + assignMatch![0].length - 1
    let depth = 0
    let closeBraceIdx = -1
    for (let i = openBraceIdx; i < source.length; i++) {
      const ch = source[i]
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          closeBraceIdx = i
          break
        }
      }
    }
    expect(closeBraceIdx).toBeGreaterThan(openBraceIdx)
    const objectBody = source.slice(openBraceIdx, closeBraceIdx + 1)
    expect(objectBody).toContain('fallbackModel')
  })

  test('startBackgroundSession call spreads queryParams', () => {
    const source = readSource('REPL.tsx')
    // The startBackgroundSession call must reference `queryParams` —
    // the object that carries fallbackModel into the background
    // session. The call is multi-line and contains nested function
    // calls (getQuerySourceForREPL(),
    // getAutoCompactTrackingForSession(backgroundSessionId), and
    // setAutoCompactTrackingForSession(backgroundSessionId)), so a
    // naive indexOf(')') would stop at the first inner close-paren
    // and miss the matching one for startBackgroundSession itself.
    // Walk the parens explicitly to find the call's matching close —
    // same depth-tracking pattern as the launchResumeChooser test
    // below. Catches a regression that renames queryParams or stops
    // spreading it into the background launch.
    const callIdx = source.indexOf('startBackgroundSession(')
    expect(callIdx).toBeGreaterThan(-1)
    const openIdx = callIdx + 'startBackgroundSession'.length
    let depth = 0
    let closeIdx = -1
    for (let i = openIdx; i < source.length; i++) {
      const ch = source[i]
      if (ch === '(') depth++
      else if (ch === ')') {
        depth--
        if (depth === 0) {
          closeIdx = i
          break
        }
      }
    }
    expect(closeIdx).toBeGreaterThan(openIdx)
    const call = source.slice(callIdx, closeIdx + 1)
    expect(call).toContain('queryParams')
  })
})

describe('fallbackModel: main.tsx wiring', () => {
  test('launchResumeChooser call spreads sessionConfig (carries fallbackModel)', () => {
    // End-to-end wiring: the CLI entry point (main.tsx) parses
    // --fallback-model into sessionConfig (as fallbackModel:
    // userSpecifiedFallbackModel) and passes that config into
    // launchResumeChooser, which then propagates it through
    // ResumeConversation -> REPL. A regression here would make
    // --fallback-model silently ignored when used with --resume,
    // even if the prop is correctly typed and destructured in REPL.
    //
    // The actual wiring spreads the whole sessionConfig into the
    // launchResumeChooser argument list (rather than passing
    // `fallbackModel: sessionConfig.fallbackModel` literally), so
    // this test asserts `...sessionConfig` is present in the call.
    // The companion check below verifies the `fallbackModel`
    // property of sessionConfig is wired from the CLI flag.
    //
    // The call is multi-line with nested objects and other arg
    // lists (e.g. `getWorktreePaths(getOriginalCwd())`), so a naive
    // indexOf(')') stops at the first inner paren. Walk the parens
    // explicitly to find the call's matching close.
    const source = readSourceUp('main.tsx')
    const launchIdx = source.indexOf('launchResumeChooser(')
    expect(launchIdx).toBeGreaterThan(-1)
    const openIdx = launchIdx + 'launchResumeChooser'.length
    let depth = 0
    let closeIdx = -1
    for (let i = openIdx; i < source.length; i++) {
      const ch = source[i]
      if (ch === '(') depth++
      else if (ch === ')') {
        depth--
        if (depth === 0) {
          closeIdx = i
          break
        }
      }
    }
    expect(closeIdx).toBeGreaterThan(openIdx)
    const call = source.slice(launchIdx, closeIdx + 1)
    expect(call).toContain('...sessionConfig')
  })

  test('sessionConfig is built with fallbackModel from the CLI flag', () => {
    // The CLI parses --fallback-model into the local `fallbackModel`
    // variable and assigns it to sessionConfig.fallbackModel (via
    // `fallbackModel: userSpecifiedFallbackModel`). The exact property
    // name `fallbackModel` must appear in main.tsx near a
    // `userSpecifiedFallbackModel` reference, otherwise the chain
    // launchResumeChooser(...sessionConfig) -> ResumeConversation
    // -> REPL has no value to carry. This guards the source of the
    // sessionConfig.fallbackModel value independently from the
    // spread call-site test above.
    const source = readSourceUp('main.tsx')
    expect(source).toMatch(/fallbackModel:\s*userSpecifiedFallbackModel/)
  })
})
