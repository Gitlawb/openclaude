import React from 'react'
import { expect, test } from 'bun:test'
import { PassThrough } from 'node:stream'
import { createRoot, Box, Text } from '../ink.js'
import type { FrameEvent } from '../ink/frame.js'
import { renderToString } from '../utils/staticRender.js'
import { agentGroupLayout, agentStatusLabel } from './agentPresentation.js'
import { renderGroupedAgentToolUse, renderToolUseProgressMessage } from '../tools/AgentTool/UI.js'
import { AgentProgressLine } from './AgentProgressLine.js'
import { emptyAgentUsage } from '../utils/agentUsage.js'
import xterm from '@xterm/headless'
import unicode11 from '@xterm/addon-unicode11'
import { ContextUsageRow } from './PromptInput/ContextUsageRow.js'

function group(count: number, tokens: number) {
  return Array.from({ length: count }, (_, index) => ({
    param: { id: `agent-${index}`, type: 'tool_use' as const, name: 'Agent', input: { description: `Worker ${index} 日本語 🚀 ${'long '.repeat(20)}`, subagent_type: 'general-purpose', prompt: 'fixture' } },
    isResolved: false, isError: false, isInProgress: true,
    progressMessages: [{ type: 'progress', uuid: `usage-${index}`, data: { type: 'agent_usage', agentId: `agent-${index}`, tokenCount: 0, toolUseCount: 1, tokenUsage: { ...emptyAgentUsage(), state: 'estimated', estimated: tokens } } }],
  }))
}

for (const [columns, rows] of [[40, 12], [80, 24], [120, 40]]) {
  for (const count of [1, 2, 8, 20]) test(`${count} agents fit ${columns}x${rows}, retain the prompt and never overflow a frame`, async () => {
    const stdout = new PassThrough() as PassThrough & { columns: number; rows: number; isTTY: boolean }
    Object.assign(stdout, { columns, rows, isTTY: true })
    const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {}, ref() {}, unref() {} })
    const frames: FrameEvent[] = []
    const terminal = new xterm.Terminal({ cols: columns, rows, allowProposedApi: true })
    terminal.loadAddon(new unicode11.Unicode11Addon())
    terminal.unicode.activeVersion = '11'
    stdout.on('data', data => terminal.write(data.toString()))
    const root = await createRoot({ stdout: stdout as unknown as NodeJS.WriteStream, stdin: stdin as unknown as NodeJS.ReadStream, patchConsole: false, onFrame: frame => frames.push(frame) })
    const layout = agentGroupLayout(columns!, rows!, count)
    const view = (tokens: number, resolved = false) => <Box flexDirection="column">{renderGroupedAgentToolUse(group(count, tokens).map(agent => ({ ...agent, isResolved: resolved, isInProgress: !resolved })) as never, { tools: [], shouldAnimate: false, terminalSize: { columns: columns!, rows: rows! } })}<Text>❯ draft preserved</Text><ContextUsageRow provider="Verboo" model="fixture-model-日本語-🚀" columns={columns!} pct={7} input="14k" window="200k" rate={42} generating={!resolved} /></Box>
    try {
      const rendered = await renderToString(view(123), columns)
      expect(rendered).toContain('draft preserved')
      expect(rendered).toContain('~123 tokens')
      if (layout.hidden) expect(rendered).toContain(`+${layout.hidden} agents`)
      expect(rendered.split('\n').length).toBeLessThanOrEqual(rows!)
      for (let frame = 0; frame < 8; frame++) {
        const content = view(frame + 100, frame === 7)
        root.render(content)
        await Bun.sleep(25)
        await new Promise<void>(resolve => terminal.write('', resolve))
        const screen = Array.from({ length: rows! }, (_, y) => (terminal.buffer.active.getLine(terminal.buffer.active.viewportY + y)?.translateToString(true) ?? '').trimEnd()).join('\n').trim()
        expect(screen).toBe((await renderToString(content, columns)).split('\n').map(line => line.trimEnd()).join('\n').trim())
      }
      expect(frames.length).toBeGreaterThan(0)
      expect(frames.flatMap(frame => frame.flickers)).toEqual([])
    } finally { root.unmount(); stdin.end(); stdout.end(); terminal.dispose() }
  })
}

test('groups share the terminal budget, including a one-line allocation', () => {
  for (const groups of [1, 2, 4]) {
    const layout = agentGroupLayout(40, 12, 20, groups)
    expect(layout.height * groups).toBeLessThanOrEqual(4)
    expect(layout.visible).toBeGreaterThanOrEqual(0)
  }
})

test.each(['failed', 'killed', 'timeout', 'max_turns', 'max_tool_calls'] as const)('%s is never presented as Done', async status => {
  const output = await renderToString(<AgentProgressLine agentType="Worker" isLast isResolved isError={status === 'failed'} shouldAnimate={false} toolUseCount={1} tokens={123} status={status} width={80} />, 80)
  expect(output).toContain(agentStatusLabel(status))
  expect(output).not.toContain('Done')
})

test('a single condensed agent retains the token unit in a narrow terminal', async () => {
  const view = renderToolUseProgressMessage(group(1, 633)[0]!.progressMessages as never, { tools: [], verbose: false, terminalSize: { columns: 40, rows: 12 } })
  expect(await renderToString(view, 40)).toContain('~633 tokens')
})

test('interrupted grouped tool results are stopped, preserving partial usage', async () => {
  const stopped = group(2, 633).map(agent => ({ ...agent, isResolved: true, isInProgress: false, isError: true, result: { param: { type: 'tool_result', tool_use_id: agent.param.id, is_error: true, content: 'Tool execution interrupted by the user.' } } }))
  const view = renderGroupedAgentToolUse(stopped as never, { tools: [], shouldAnimate: false, terminalSize: { columns: 40, rows: 12 } })
  const output = await renderToString(view, 40)
  expect(output).toContain('Stopped')
  expect(output).toContain('~633 tokens')
  expect(output).not.toContain('Failed')
})
