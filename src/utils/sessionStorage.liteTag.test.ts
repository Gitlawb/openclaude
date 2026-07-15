import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { readLiteMetadata } from './sessionStorage.js'
import { LITE_READ_BUF_SIZE } from './sessionStoragePortable.js'

/** Write a session JSONL to a temp file and read its lite metadata back. */
async function readMetadata(lines: string[]) {
  const dir = mkdtempSync(join(tmpdir(), 'lite-tag-'))
  const file = join(dir, 'session.jsonl')
  try {
    writeFileSync(file, lines.join('\n') + '\n')
    const size = statSync(file).size
    return await readLiteMetadata(file, size, Buffer.alloc(LITE_READ_BUF_SIZE))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const USER_LINE =
  '{"type":"user","message":{"role":"user","content":"hi"},"cwd":"/work/app"}'

// A tool call carrying a `tag` parameter — Docker image tags, git tags and
// cloud resource tags all look like this. It is stored as literal nested JSON
// inside the assistant entry, and is appended *after* the tag entry.
const TOOL_USE_WITH_TAG_INPUT =
  '{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"mcp__docker__push_image","input":{"image":"myapp","tag":"v1.2.3"}}]}}'

describe('readLiteMetadata tag extraction', () => {
  test('reads the session tag, not a tag parameter from a later tool call', async () => {
    // The tail scan is a raw substring search, so an unscoped lookup returned
    // the *last* "tag":"..." in the window — the tool's value — which surfaced
    // a phantom tag tab in /resume and misfiled the session away from its own.
    const meta = await readMetadata([
      USER_LINE,
      '{"type":"tag","tag":"backend","sessionId":"S1"}',
      TOOL_USE_WITH_TAG_INPUT,
    ])
    expect(meta.tag).toBe('backend')
  })

  test('does not invent a tag for an untagged session', async () => {
    const meta = await readMetadata([USER_LINE, TOOL_USE_WITH_TAG_INPUT])
    expect(meta.tag).toBeUndefined()
  })

  test('treats a cleared tag as untagged', async () => {
    // tagSession(id, null) writes tag:"" to clear.
    const meta = await readMetadata([
      USER_LINE,
      '{"type":"tag","tag":"backend","sessionId":"S1"}',
      '{"type":"tag","tag":"","sessionId":"S1"}',
    ])
    expect(meta.tag).toBeUndefined()
  })

  test('uses the most recent tag entry', async () => {
    const meta = await readMetadata([
      USER_LINE,
      '{"type":"tag","tag":"backend","sessionId":"S1"}',
      '{"type":"tag","tag":"frontend","sessionId":"S1"}',
    ])
    expect(meta.tag).toBe('frontend')
  })
})
