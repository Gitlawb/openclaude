/**
 * Pure helpers for the post-build "missing-module stub" tripwire in build.ts.
 *
 * Extracted so the marker parsing can be unit-tested against synthetic bundle
 * text (e.g. Windows-style paths that never appear in a macOS/Linux build).
 */

/**
 * Canonicalize a `missing-module-stub:` marker to a host-stable, src-relative
 * key. The per-importer scanner records each stub as the resolved absolute
 * source path, which differs only by the repo-root prefix across build hosts
 * (and uses `\` separators on Windows). Keying on the path from `src/` onward
 * without extension is stable across hosts yet still path-specific, so a stub
 * named `constants.ts` in one directory cannot mask a different `constants.ts`
 * elsewhere (a basename-only key would).
 */
export function canonicalStub(marker: string): string {
  const normalized = marker.split(/[\\/]/).join('/')
  const srcIdx = normalized.lastIndexOf('/src/')
  const fromSrc = srcIdx >= 0 ? normalized.slice(srcIdx + 1) : normalized
  return fromSrc.replace(/\.(?:[cm]?[jt]sx?)$/, '')
}

// The marker appears in two forms and each has its own terminator, so each is
// matched with a delimiter-correct pattern rather than a single character class.
// Matching to the right delimiter (not "stop at the first space/backslash") is
// what keeps paths containing spaces (`C:\\Users\\Jane Doe\\...`) or backslashes
// intact for canonicalStub().

// Form 1 — the string literal the stub loader emits via
// `JSON.stringify(\`missing-module-stub:${path}\`)`, which survives minification.
// Capture from the opening quote to the matching (back-referenced) closing quote,
// consuming escaped pairs (`\\.`) so an escaped quote/backslash never ends the
// match early. Bun may re-quote with ' or " when minifying, hence the backref.
const STUB_MARKER_STRING_PATTERN =
  /(["'])missing-module-stub:((?:\\.|(?!\1).)*)\1/g

// Form 2 — Bun's module-boundary comment in unminified builds. The path is raw
// (single separators, no escaping) and runs to end of line.
const STUB_MARKER_COMMENT_PATTERN = /\/\/[^\S\n]*missing-module-stub:([^\n]*)/g

// Reverse the JS/JSON string escaping applied to Form 1 (`\\` -> `\`, `\"` -> `"`)
// so canonicalStub() sees real path separators instead of doubled backslashes.
function unescapeStringLiteral(value: string): string {
  return value.replace(/\\(.)/g, '$1')
}

/**
 * Extract every missing-module stub marker from a built bundle, mapping each
 * canonical src-relative key to the raw (separator-normalized) marker text,
 * which is kept for human-readable diagnostics.
 */
export function collectBundleStubs(bundleText: string): Map<string, string> {
  const stubbed = new Map<string, string>()
  const record = (marker: string): void => {
    stubbed.set(canonicalStub(marker), marker)
  }
  for (const m of bundleText.matchAll(STUB_MARKER_STRING_PATTERN)) {
    record(unescapeStringLiteral(m[2]!))
  }
  for (const m of bundleText.matchAll(STUB_MARKER_COMMENT_PATTERN)) {
    record(m[1]!.replace(/\s+$/, ''))
  }
  return stubbed
}
