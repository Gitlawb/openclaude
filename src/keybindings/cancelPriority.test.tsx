import { PassThrough } from 'node:stream'
import React, { useRef, useState } from 'react'
import { expect, test } from 'bun:test'
import { Box, createRoot, useInput } from '../ink.js'
import { AppStateProvider } from '../state/AppState.js'
import { CancelRequestHandler } from '../hooks/useCancelRequest.js'
import { KeybindingProvider } from './KeybindingContext.js'
import { parseBindings, parseKeystroke } from './parser.js'
import type { KeybindingContextName, ParsedKeystroke } from './types.js'
import { enqueue, getCommandQueue, resetCommandQueue } from '../utils/messageQueueManager.js'
import instances from '../ink/instances.js'
import { finishSelection, startSelection, updateSelection } from '../ink/selection.js'

const bindings = parseBindings([
  { context: 'Chat', bindings: { escape: 'chat:cancel' } },
  { context: 'Global', bindings: { 'ctrl+c': 'app:interrupt' } },
  { context: 'Confirmation', bindings: { escape: 'confirm:no' } },
])

test.each([
  ['legacy Esc', '\x1b'],
  ['CSI-u Esc', '\x1b[27u'],
  ['Kitty press/release', '\x1b[27;1:1u\x1b[27;1:3u'],
  ['modifyOtherKeys Esc', '\x1b[27;1;27~'],
  ['Ctrl+C', '\x03'],
  ['task dialog Esc', '\x1b', true],
])('%s respects task management focus and otherwise cancels active work before modal/Vim/chord handlers', async (_name, sequence, taskDialog = false) => {
  const stdout = new PassThrough()
  stdout.resume()
  const stdin = Object.assign(new PassThrough(), {
    isTTY: true, setRawMode: () => {}, ref: () => {}, unref: () => {},
  })
  let active = true
  let cancelled = 0
  let modalKeys = 0
  let domKeys = 0
  let copied = 0
  let selectionInk: ReturnType<typeof instances.get>
  function Modal() {
    useInput((_input, key, event) => {
      if (key.ctrl && _input === 'c' && selectionInk?.hasTextSelection()) {
        copied++
        selectionInk.clearTextSelection()
        event.stopImmediatePropagation()
      }
      if (key.escape) { modalKeys++; event.stopImmediatePropagation() }
    })
    return <Box tabIndex={0} autoFocus onKeyDown={() => { domKeys++ }} />
  }
  function Harness() {
    const pendingChordRef = useRef<ParsedKeystroke[] | null>([parseKeystroke('ctrl+x')])
    const [pendingChord, updatePending] = useState(pendingChordRef.current)
    const activeContexts = useRef(new Set<KeybindingContextName>(['Confirmation']))
    const registry = useRef(new Map())
    return <AppStateProvider><KeybindingProvider bindings={bindings}
      pendingChordRef={pendingChordRef} pendingChord={pendingChord}
      setPendingChord={(chord: ParsedKeystroke[] | null) => { pendingChordRef.current = chord; updatePending(chord) }}
      activeContexts={activeContexts.current} registerActiveContext={() => {}}
      unregisterActiveContext={() => {}} handlerRegistryRef={registry}>
      <Modal />
      <CancelRequestHandler canCancelWork={() => active} isQueuePaused={() => !active}
        onCancel={() => { active = false; cancelled++ }} onAgentsKilled={() => {}}
        screen="transcript" isMessageSelectorVisible isLocalJSXCommand isSearchingHistory
        isTaskDialogVisible={taskDialog}
        isHelpOpen vimMode="INSERT" inputMode="bash" inputValue="" />
    </KeybindingProvider></AppStateProvider>
  }
  const root = await createRoot({ stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream, patchConsole: false, exitOnCtrlC: false })
  const previousInstance = instances.get(process.stdout)
  if (sequence === '\x03') {
    selectionInk = instances.get(stdout as unknown as NodeJS.WriteStream)!
    instances.set(process.stdout, selectionInk)
    startSelection(selectionInk.selection, 0, 0)
    updateSelection(selectionInk.selection, 3, 0)
    finishSelection(selectionInk.selection)
  }
  try {
    root.render(<Harness />)
    await Bun.sleep(30)
    if (selectionInk) {
      stdin.write('\x03')
      await Bun.sleep(30)
      expect(cancelled).toBe(0)
      expect(copied).toBe(1)
    }
    stdin.write(sequence)
    await Bun.sleep(100)
    if (taskDialog) {
      expect(cancelled).toBe(0)
      expect(modalKeys).toBe(1)
      return
    }
    expect(cancelled).toBe(1)
    expect(modalKeys).toBe(0)
    expect(domKeys).toBe(0)
    stdin.write('\x1b[27u')
    await Bun.sleep(30)
    expect(cancelled).toBe(1)
    expect(modalKeys).toBe(1)
    stdin.write('a')
    await Bun.sleep(30)
    expect(domKeys).toBe(1)
  } finally {
    root.unmount()
    if (selectionInk) {
      if (previousInstance) instances.set(process.stdout, previousInstance)
      else instances.delete(process.stdout)
    }
    stdin.end()
    stdout.end()
  }
})

test('repeated Esc before rendering cannot pop a just-paused queue', async () => {
  resetCommandQueue()
  enqueue({ value: 'keep this message', mode: 'prompt' })
  const stdout = new PassThrough()
  stdout.resume()
  const stdin = Object.assign(new PassThrough(), {
    isTTY: true, setRawMode: () => {}, ref: () => {}, unref: () => {},
  })
  let active = true
  let paused = false
  let popped = 0
  let cancelled = 0
  function Harness() {
    const pendingChordRef = useRef<ParsedKeystroke[] | null>(null)
    const registry = useRef(new Map())
    return <AppStateProvider><KeybindingProvider bindings={bindings}
      pendingChordRef={pendingChordRef} pendingChord={null} setPendingChord={() => {}}
      activeContexts={new Set()} registerActiveContext={() => {}}
      unregisterActiveContext={() => {}} handlerRegistryRef={registry}>
      <CancelRequestHandler canCancelWork={() => active} isQueuePaused={() => paused}
        onCancel={() => { active = false; paused = true; cancelled++ }}
        popCommandFromQueue={() => { popped++; resetCommandQueue() }}
        onAgentsKilled={() => {}} screen="prompt" isMessageSelectorVisible={false} />
    </KeybindingProvider></AppStateProvider>
  }
  const root = await createRoot({ stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream, patchConsole: false, exitOnCtrlC: false })
  try {
    root.render(<Harness />)
    await Bun.sleep(30)
    stdin.write('\x1b[27u\x1b[27;1:2u\x1b[27u')
    await Bun.sleep(30)
    expect(cancelled).toBe(1)
    expect(popped).toBe(0)
    expect(getCommandQueue().map(command => command.value)).toEqual(['keep this message'])
  } finally {
    root.unmount()
    stdin.end()
    stdout.end()
    resetCommandQueue()
  }
})
