import { PassThrough } from 'node:stream'

import { expect, test } from 'bun:test'
import React from 'react'

import type { DOMElement, ElementNames } from './dom.ts'
import instances from './instances.ts'
import { LayoutEdge } from './layout/node.ts'
import type { ParsedKey } from './parse-keypress.ts'
import { createRoot } from './root.ts'

type TestStdin = PassThrough & {
  isTTY: boolean
  setRawMode: (mode: boolean) => void
  ref: () => void
  unref: () => void
}

const RAW_TEXT_STYLE = {
  flexDirection: 'row',
  flexGrow: 0,
  flexShrink: 1,
  textWrap: 'wrap',
} as const

function createTestStreams(): {
  stdout: PassThrough
  stdin: TestStdin
} {
  const stdout = new PassThrough()
  const stdin = new PassThrough() as TestStdin

  stdin.isTTY = true
  stdin.setRawMode = () => {}
  stdin.ref = () => {}
  stdin.unref = () => {}

  ;(stdout as unknown as { columns: number }).columns = 120
  ;(stdout as unknown as { rows: number }).rows = 24
  ;(stdout as unknown as { isTTY: boolean }).isTTY = true

  return { stdout, stdin }
}

async function waitForCondition(
  predicate: () => boolean,
  errorMessage: string,
  timeoutMs = 2000,
): Promise<void> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return
    }

    await Bun.sleep(10)
  }

  throw new Error(errorMessage)
}

function getRootNode(stdout: PassThrough): DOMElement {
  const instance = getInkInstance(stdout)

  if (!instance.rootNode) {
    throw new Error('Ink instance root node not found')
  }

  return instance.rootNode
}

function getInkInstance(stdout: PassThrough): {
  rootNode?: DOMElement
  dispatchKeyboardEvent: (parsedKey: ParsedKey) => void
} {
  const instance = instances.get(
    stdout as unknown as NodeJS.WriteStream,
  ) as
    | {
        rootNode?: DOMElement
        dispatchKeyboardEvent: (parsedKey: ParsedKey) => void
      }
    | undefined

  if (!instance) {
    throw new Error('Ink instance not found')
  }

  return instance
}

function findElement(
  node: DOMElement,
  nodeName: ElementNames,
): DOMElement | undefined {
  if (node.nodeName === nodeName) {
    return node
  }

  for (const child of node.childNodes) {
    if (child.nodeName === '#text') {
      continue
    }

    const found = findElement(child, nodeName)
    if (found) {
      return found
    }
  }

  return undefined
}

function requireElement(stdout: PassThrough, nodeName: ElementNames): DOMElement {
  const found = findElement(getRootNode(stdout), nodeName)

  if (!found) {
    throw new Error(`Expected to find ${nodeName} in Ink root tree`)
  }

  return found
}

async function createHarness(): Promise<{
  stdout: PassThrough
  stdin: TestStdin
  root: Awaited<ReturnType<typeof createRoot>>
  dispose: () => Promise<void>
}> {
  const { stdout, stdin } = createTestStreams()
  const root = await createRoot({
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    patchConsole: false,
  })

  return {
    stdout,
    stdin,
    root,
    dispose: async () => {
      root.unmount()
      stdin.end()
      stdout.end()
      await Bun.sleep(25)
    },
  }
}

test('raw ink-box updates keyboard handlers and attributes in place across rerenders', async () => {
  const calls: string[] = []
  const firstHandler = () => calls.push('first')
  const secondHandler = () => calls.push('second')
  const harness = await createHarness()

  try {
    harness.root.render(
      React.createElement(
        'ink-box',
        {
          autoFocus: true,
          onKeyDown: firstHandler,
          tabIndex: 0,
        },
        'first render',
      ),
    )

    await Bun.sleep(25)

    const firstBox = requireElement(harness.stdout, 'ink-box')
    expect(firstBox.attributes.tabIndex).toBe(0)
    expect(firstBox._eventHandlers?.onKeyDown).toBe(firstHandler)

    harness.root.render(
      React.createElement(
        'ink-box',
        {
          autoFocus: true,
          onKeyDown: secondHandler,
          tabIndex: 1,
        },
        'second render',
      ),
    )

    await Bun.sleep(25)

    const secondBox = requireElement(harness.stdout, 'ink-box')
    expect(secondBox).toBe(firstBox)
    expect(secondBox.attributes.tabIndex).toBe(1)
    expect(secondBox._eventHandlers?.onKeyDown).toBe(secondHandler)

    getInkInstance(harness.stdout).dispatchKeyboardEvent({
      kind: 'key',
      name: 'a',
      fn: false,
      ctrl: false,
      meta: false,
      shift: false,
      option: false,
      super: false,
      sequence: 'a',
      raw: 'a',
      isPasted: false,
    })

    await waitForCondition(
      () => calls.length === 1,
      'Timed out waiting for rerendered onKeyDown handler to fire',
    )

    expect(calls).toEqual(['second'])
  } finally {
    await harness.dispose()
  }
})

test('raw ink-text updates textStyles in place across rerenders', async () => {
  const harness = await createHarness()

  try {
    harness.root.render(
      React.createElement(
        'ink-text',
        {
          style: RAW_TEXT_STYLE,
          textStyles: { color: 'ansi:red' },
        },
        'host text',
      ),
    )

    await Bun.sleep(25)

    const firstText = requireElement(harness.stdout, 'ink-text')
    expect(firstText.textStyles).toEqual({ color: 'ansi:red' })

    harness.root.render(
      React.createElement(
        'ink-text',
        {
          style: RAW_TEXT_STYLE,
          textStyles: { color: 'ansi:blue' },
        },
        'host text',
      ),
    )

    await Bun.sleep(25)

    const secondText = requireElement(harness.stdout, 'ink-text')
    expect(secondText).toBe(firstText)
    expect(secondText.textStyles).toEqual({ color: 'ansi:blue' })
  } finally {
    await harness.dispose()
  }
})

test('raw ink-box removes event handler when set to undefined', async () => {
  const calls: string[] = []
  const handler = () => calls.push('fired')
  const harness = await createHarness()

  try {
    harness.root.render(
      React.createElement(
        'ink-box',
        {
          autoFocus: true,
          onKeyDown: handler,
          tabIndex: 0,
        },
        'with handler',
      ),
    )

    await Bun.sleep(25)

    const box = requireElement(harness.stdout, 'ink-box')
    expect(box._eventHandlers?.onKeyDown).toBe(handler)

    // Remove the handler
    harness.root.render(
      React.createElement(
        'ink-box',
        {
          autoFocus: true,
          tabIndex: 0,
        },
        'without handler',
      ),
    )

    await Bun.sleep(25)

    const sameBox = requireElement(harness.stdout, 'ink-box')
    expect(sameBox).toBe(box)
    expect(sameBox._eventHandlers?.onKeyDown).toBeUndefined()

    // Dispatch a key event and verify the removed handler is NOT called
    getInkInstance(harness.stdout).dispatchKeyboardEvent({
      kind: 'key',
      name: 'a',
      fn: false,
      ctrl: false,
      meta: false,
      shift: false,
      option: false,
      super: false,
      sequence: 'a',
      raw: 'a',
      isPasted: false,
    })

    await Bun.sleep(50)
    expect(calls).toEqual([])
  } finally {
    await harness.dispose()
  }
})

test('raw ink-box updates layout style in place across rerenders', async () => {
  const harness = await createHarness()

  try {
    harness.root.render(
      React.createElement(
        'ink-box',
        {
          style: { flexDirection: 'row', paddingLeft: 1 },
        },
        'styled box',
      ),
    )

    await Bun.sleep(25)

    const box = requireElement(harness.stdout, 'ink-box')
    expect(box.style.flexDirection).toBe('row')
    expect(box.style.paddingLeft).toBe(1)

    harness.root.render(
      React.createElement(
        'ink-box',
        {
          style: { flexDirection: 'column', paddingLeft: 2 },
        },
        'styled box',
      ),
    )

    await Bun.sleep(25)

    const sameBox = requireElement(harness.stdout, 'ink-box')
    expect(sameBox).toBe(box)
    expect(sameBox.style.flexDirection).toBe('column')
    expect(sameBox.style.paddingLeft).toBe(2)

    // Verify the update reached the layout engine, not just the style object
    const yogaNode = sameBox.yogaNode!
    expect(yogaNode).toBeDefined()
    yogaNode.calculateLayout(120)
    expect(yogaNode.getComputedPadding(LayoutEdge.Left)).toBe(2)
  } finally {
    await harness.dispose()
  }
})
