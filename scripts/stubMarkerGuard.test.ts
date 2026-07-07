import { expect, test } from 'bun:test'

import { canonicalStub, collectBundleStubs } from './stubMarkerGuard.js'

test('canonicalStub keys on the src-relative path across separators', () => {
  expect(canonicalStub('/home/runner/work/openclaude/openclaude/src/commands/dream/dream.ts')).toBe(
    'src/commands/dream/dream',
  )
  // Windows separators normalize to the same key.
  expect(canonicalStub('C:\\repo\\openclaude\\src\\commands\\dream\\dream.ts')).toBe(
    'src/commands/dream/dream',
  )
})

test('collectBundleStubs parses the JSON string-literal marker (minified builds)', () => {
  const bundle = `;(globalThis.__openclaudeStubMarkers ??= []).push("missing-module-stub:/build/src/utils/foo.js");`
  const stubbed = collectBundleStubs(bundle)
  expect([...stubbed.keys()]).toEqual(['src/utils/foo'])
})

test('collectBundleStubs parses Bun module-boundary comments (unminified builds)', () => {
  const bundle = `// missing-module-stub:/build/src/utils/foo.js\nvar foo = {};`
  const stubbed = collectBundleStubs(bundle)
  expect([...stubbed.keys()]).toEqual(['src/utils/foo'])
})

// Regression for the CodeRabbit/jatmn review on PR #1743: the marker regex
// previously excluded backslashes, so a JSON-escaped Windows path was captured
// as only `C:` and canonicalized to the wrong key — letting a newly stubbed
// module slip past the tripwire on Windows build hosts.
test('collectBundleStubs keeps Windows paths intact in the string-literal marker', () => {
  // JSON.stringify doubles the backslashes, matching what ships in the bundle.
  const marker = JSON.stringify('missing-module-stub:C:\\repo\\openclaude\\src\\commands\\dream\\dream.js')
  const bundle = `;(globalThis.__openclaudeStubMarkers ??= []).push(${marker});`

  const stubbed = collectBundleStubs(bundle)

  // The canonical key must be the real src-relative path, not a `C:` fragment.
  expect([...stubbed.keys()]).toEqual(['src/commands/dream/dream'])
  expect(stubbed.has('src/commands/dream/dream')).toBe(true)
  expect([...stubbed.keys()]).not.toContain('C:')
})

// Regression for the CodeRabbit follow-up on PR #1743: a checkout path with a
// space (e.g. `C:\Users\Jane Doe\...`) must survive to the canonical key. The
// terminator is the closing quote, not the first space.
test('collectBundleStubs keeps spaced Windows paths intact in the string-literal marker', () => {
  const marker = JSON.stringify(
    'missing-module-stub:C:\\Users\\Jane Doe\\openclaude\\src\\commands\\dream\\dream.js',
  )
  const bundle = `;(globalThis.__openclaudeStubMarkers ??= []).push(${marker});`

  const stubbed = collectBundleStubs(bundle)

  expect([...stubbed.keys()]).toEqual(['src/commands/dream/dream'])
  expect([...stubbed.keys()]).not.toContain('C:')
})

test('collectBundleStubs keeps spaced paths intact in the comment marker', () => {
  const bundle = `// missing-module-stub:/home/jane doe/openclaude/src/utils/foo.js\nvar foo = {};`

  const stubbed = collectBundleStubs(bundle)

  expect([...stubbed.keys()]).toEqual(['src/utils/foo'])
})

// jatmn's exact scenario: a Unix checkout under a spaced directory must resolve
// to the stable src/... key in the minified string-literal marker.
test('collectBundleStubs handles paths containing spaces', () => {
  const marker = JSON.stringify(
    'missing-module-stub:/Users/John Doe/projects/openclaude/src/utils/foo.js',
  )
  const bundle = `;(globalThis.__openclaudeStubMarkers ??= []).push(${marker});`

  expect([...collectBundleStubs(bundle).keys()]).toEqual(['src/utils/foo'])
})

// A single minified line can hold several markers; greedy capture must stop at
// each closing quote rather than swallowing everything up to the last one.
test('collectBundleStubs parses multiple markers on one minified line', () => {
  const bundle =
    `.push("missing-module-stub:/b/src/a/one.js"),x.push("missing-module-stub:/b/src/a/two.js");`

  const stubbed = collectBundleStubs(bundle)

  expect(new Set(stubbed.keys())).toEqual(new Set(['src/a/one', 'src/a/two']))
})
