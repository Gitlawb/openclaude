import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { startCli } from './terminal.mjs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import stripAnsi from 'strip-ansi'

after(() => {
  // Let normal native/IPC cleanup finish, but fail promptly if a PTY worker
  // keeps the test process alive after all cases and artifacts have completed.
  setTimeout(() => {
    console.error('PTY suite leaked active resources:', process.getActiveResourcesInfo())
    process.exit(1)
  }, 10_000).unref()
})

async function metadata(cli) {
  const root = join(cli.dir, 'projects')
  const files = await readdir(root, { recursive: true })
  return Promise.all(files.filter(file => file.endsWith('.meta.json')).map(async file => JSON.parse(await readFile(join(root, file), 'utf8'))))
}
const estimated = cli => cli.frames.some(frame => /~[1-9][\d.,k]* tokens/.test(frame.text))
const completed = cli => cli.frames.some(frame => frame.text.includes('E2E_COMPLETE'))

for (const fullscreen of [false, true]) for (const [columns, rows] of [[40, 12], [80, 24], [120, 40]]) for (const agents of [1, 2, 8, 20]) {
  test(`installed CLI: ${agents} agents, ${columns}x${rows}, fullscreen=${fullscreen}`, { timeout: 60_000 }, async () => {
    const cli = await startCli({ columns, rows, fullscreen, routerOptions: { agents }, args: ['E2E_PARENT: delegate to the fixture agents.'] })
    try {
      await cli.waitFor(() => estimated(cli))
      await cli.waitFor(() => completed(cli))
      assert.deepEqual(cli.router.unexpected, [])
      assert.ok(cli.router.requests.length >= agents + 2)
      assert.ok(cli.frames.some(frame => frame.text.includes('144 tokens')), 'final usage must appear on screen')
      const records = await metadata(cli)
      assert.equal(records.length, agents)
      for (const record of records) assert.deepEqual(record.tokenUsage, { confirmed: 144, estimated: 0, state: 'reported', inputTokens: 115, outputTokens: 24, cacheReadTokens: 5, cacheCreationTokens: 0 })
      // VT permits cursorX === columns while a right-margin autowrap is pending.
      assert.ok(cli.frames.every(frame => frame.cursorY < frame.rows && frame.cursorX <= frame.columns))
    } finally { await cli.stop() }
  })
}

for (const [name, options, state, confirmed] of [
  ['missing usage', { omitUsage: true }, 'estimated', 0],
  ['partial usage', { partialUsage: true }, 'estimated', 120],
  ['explicit zero', { zeroUsage: true }, 'reported', 0],
]) test(`installed CLI retains ${name} accurately after completion`, { timeout: 60_000 }, async () => {
  const cli = await startCli({ routerOptions: options, args: ['E2E_PARENT: delegate to fixture agents.'] })
  try {
    await cli.waitFor(() => completed(cli))
    const records = await metadata(cli)
    assert.equal(records.length, 2)
    for (const record of records) {
      assert.equal(record.tokenUsage.state, state)
      assert.equal(record.tokenUsage.confirmed, confirmed)
      assert.equal(record.tokenUsage.estimated > 0, state === 'estimated')
    }
  } finally { await cli.stop() }
})

test('resize and Esc preserve a typed draft while stopping active agents', { timeout: 60_000 }, async () => {
  const cli = await startCli({ fullscreen: true, routerOptions: { agents: 8, stall: true }, args: ['E2E_PARENT: delegate to fixture agents.'] })
  try {
    await cli.waitFor(() => estimated(cli))
    cli.write('draft-preserved')
    await cli.waitFor(() => cli.screen().includes('draft-preserved'))
    for (const [cols, rows] of [[40, 12], [120, 40], [80, 24]]) {
      cli.resize(cols, rows)
      await cli.waitFor(() => cli.frames.at(-1)?.columns === cols && cli.screen().includes('draft-preserved'))
    }
    cli.write('\x1b')
    await cli.waitFor(() => /Interrupted|Stopped|interrupted|stopped/.test(cli.screen()))
    await cli.waitFor(() => cli.screen().includes('Stopped · Worker'))
    assert.ok(cli.screen().includes('draft-preserved'))
    await cli.waitFor(() => cli.router.activeAgents.size === 0)
    await delay(250)
    const requests = cli.router.requests.length
    await delay(250)
    assert.equal(cli.router.requests.length, requests, 'cancelled agents must not restart requests')
  } finally { await cli.stop() }
})

test('background agents keep reporting usage after the parent tool returns', { timeout: 60_000 }, async () => {
  const cli = await startCli({ routerOptions: { background: true }, args: ['E2E_PARENT: delegate to fixture agents in the background.'] })
  try {
    await cli.waitFor(() => estimated(cli))
    await cli.waitFor(() => completed(cli) && cli.frames.some(frame => frame.text.includes('144 tokens')))
    await cli.waitFor(async () => {
      const records = await metadata(cli)
      return records.length === 2 && records.every(record => record.tokenUsage?.confirmed === 144)
    })
    const records = await metadata(cli)
    assert.equal(records.length, 2)
    for (const record of records) assert.equal(record.tokenUsage.confirmed, 144)
  } finally { await cli.stop() }
})

test('background task menu remains usable while agents stream', { timeout: 60_000 }, async () => {
  const cli = await startCli({ fullscreen: true, routerOptions: { background: true, stall: true }, args: ['E2E_PARENT: delegate to fixture agents in the background.'] })
  try {
    await cli.waitFor(() => estimated(cli) && completed(cli))
    cli.write('\x1b[1;2B') // Shift+Down opens background task management.
    await cli.waitFor(() => cli.screen().includes('Background tasks'))
    assert.ok(cli.screen().includes('2 active agents'))
    cli.write('\r')
    await cli.waitFor(() => cli.screen().includes('Prompt') && /~[1-9][\d.,k]* tokens/.test(cli.screen()))
    cli.write('\x1b')
    await cli.waitFor(() => !cli.screen().includes('Prompt'))
    cli.write('menu-draft-preserved')
    await cli.waitFor(() => cli.screen().includes('menu-draft-preserved'))
    assert.equal(cli.router.activeAgents.size, 2, 'closing the detail dialog must not stop agents')
  } finally { await cli.stop() }
})

test('installed streaming JSON emits confirmed agent usage and optional estimates', { timeout: 60_000 }, async () => {
  const cli = await startCli({ args: ['--print', '--verbose', '--output-format', 'stream-json', 'E2E_PARENT: delegate to fixture agents.'] })
  try {
    await cli.waitFor(() => Boolean(cli.exited))
    assert.equal(cli.exited.exitCode, 0)
    const events = stripAnsi(cli.raw).split(/\r?\n/).filter(line => line.startsWith('{')).map(line => JSON.parse(line))
    const progress = events.filter(event => event.subtype === 'task_progress')
    assert.ok(progress.some(event => event.usage.token_usage?.state === 'estimated'))
    const finished = events.filter(event => event.subtype === 'task_notification' && event.status === 'completed')
    assert.equal(finished.length, 2)
    for (const event of finished) {
      assert.equal(event.usage.total_tokens, 144)
      assert.equal(event.usage.token_usage.confirmed, 144)
      assert.equal(event.usage.token_usage.estimated, 0)
    }
  } finally { await cli.stop() }
})

test('provider failures are not displayed as successful agent completions', { timeout: 60_000 }, async () => {
  const cli = await startCli({ columns: 40, rows: 12, routerOptions: { childFailure: true }, args: ['E2E_PARENT: delegate to fixture agents.'] })
  try {
    await cli.waitFor(() => completed(cli))
    assert.ok(cli.frames.some(frame => frame.text.includes('Failed · Work')))
    assert.ok(!cli.frames.some(frame => frame.text.includes('Done · Work')))
  } finally { await cli.stop() }
})

test('an agent hitting max_turns reports its limit and confirmed usage', { timeout: 60_000 }, async () => {
  const cli = await startCli({ routerOptions: { childToolLoop: true }, args: ['E2E_PARENT: delegate to fixture agents.'] })
  try {
    await cli.waitFor(() => completed(cli))
    assert.ok(cli.frames.some(frame => frame.text.includes('Turn limit reached')))
    assert.ok(!cli.frames.some(frame => /└\s+Done/.test(frame.text)))
    const records = await metadata(cli)
    assert.equal(records.length, 2)
    for (const record of records) assert.equal(record.tokenUsage.confirmed, 144)
  } finally { await cli.stop() }
})
