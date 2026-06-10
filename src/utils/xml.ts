/**
 * Escape XML/HTML special characters for safe interpolation into element
 * text content (between tags). Use when untrusted strings (process stdout,
 * user input, external data) go inside `<tag>${here}</tag>`.
 *
 * Accepts null/undefined and returns an empty string. Shell-tool outputs
 * (BashTool/ShellError) frequently surface `stderr` / `stdout` as null when
 * the stream produced nothing, and the previous `s.replace` call crashed the
 * REPL with `TypeError: Cannot read properties of null` (#1247).
 */
export function escapeXml(s: string | null | undefined): string {
  if (s == null) return ''
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Escape for interpolation into a double- or single-quoted attribute value:
 * `<tag attr="${here}">`. Escapes quotes in addition to `& < >`. Same
 * null/undefined tolerance as `escapeXml`.
 */
export function escapeXmlAttr(s: string | null | undefined): string {
  return escapeXml(s).replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

/**
 * Decode XML/HTML entities produced by `escapeXml` back to literal characters.
 * Handles &amp; &lt; &gt;. Must decode &lt; and &gt; first, then &amp; last,
 * so that literal entity text (e.g. &amp;lt;tag&amp;gt;&amp;amp;) round-trips
 * correctly without premature double-decoding.
 */
export function unescapeXml(s: string | null | undefined): string {
  if (s == null) return ''
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}
