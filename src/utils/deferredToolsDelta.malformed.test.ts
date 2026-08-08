import { expect, test } from 'bun:test'
import type { Message } from '../types/message.js'
import type { Tools } from '../Tool.js'
import { getDeferredToolsDelta } from './toolSearch.js'

test('getDeferredToolsDelta skips null attachment payloads without throwing', () => {
  const messages = [
    {
      type: 'attachment',
      uuid: '00000000-0000-4000-8000-00000000d001',
      attachment: null,
    } as unknown as Message,
  ]
  expect(() => getDeferredToolsDelta([] as Tools, messages)).not.toThrow()
  expect(getDeferredToolsDelta([] as Tools, messages)).toBeNull()
})

test('getDeferredToolsDelta skips partial deferred_tools_delta without removedNames', () => {
  const messages = [
    {
      type: 'attachment',
      uuid: '00000000-0000-4000-8000-00000000d002',
      attachment: {
        type: 'deferred_tools_delta',
        addedNames: ['SomeTool'],
        // missing removedNames / addedLines
      },
    } as unknown as Message,
  ]
  expect(() => getDeferredToolsDelta([] as Tools, messages)).not.toThrow()
  expect(getDeferredToolsDelta([] as Tools, messages)).toBeNull()
})

test('getDeferredToolsDelta ignores record missing addedLines and emits current deferred tool as addition', () => {
  // Names + removedNames without addedLines must fail closed: do not mark
  // the tool announced, so the current deferred tool is still emitted.
  const messages = [
    {
      type: 'attachment',
      uuid: '00000000-0000-4000-8000-00000000d004',
      attachment: {
        type: 'deferred_tools_delta',
        addedNames: ['SomeTool'],
        removedNames: [],
        // missing addedLines
      },
    } as unknown as Message,
  ]
  const tools = [
    { name: 'SomeTool', isMcp: true },
  ] as unknown as Tools
  const delta = getDeferredToolsDelta(tools, messages)
  expect(delta).not.toBeNull()
  expect(delta!.addedNames).toEqual(['SomeTool'])
  expect(delta!.removedNames).toEqual([])
})

test('getDeferredToolsDelta ignores non-string addedLines and emits current deferred tool as addition', () => {
  const messages = [
    {
      type: 'attachment',
      uuid: '00000000-0000-4000-8000-00000000d005',
      attachment: {
        type: 'deferred_tools_delta',
        addedNames: ['SomeTool'],
        addedLines: [null],
        removedNames: [],
      },
    } as unknown as Message,
  ]
  const tools = [
    { name: 'SomeTool', isMcp: true },
  ] as unknown as Tools
  const delta = getDeferredToolsDelta(tools, messages)
  expect(delta).not.toBeNull()
  expect(delta!.addedNames).toEqual(['SomeTool'])
  expect(delta!.removedNames).toEqual([])
})

test('getDeferredToolsDelta holds removals for complete records when tools pool is empty', () => {
  const messages = [
    {
      type: 'attachment',
      uuid: '00000000-0000-4000-8000-00000000d003',
      attachment: {
        type: 'deferred_tools_delta',
        addedNames: ['SomeTool'],
        addedLines: ['SomeTool'],
        removedNames: [],
      },
    } as unknown as Message,
  ]
  // Resume race: empty pool is unsettled — do not emit removal.
  expect(getDeferredToolsDelta([] as Tools, messages)).toBeNull()
})

test('getDeferredToolsDelta removes announced tool once pool is settled without it', () => {
  const messages = [
    {
      type: 'attachment',
      uuid: '00000000-0000-4000-8000-00000000d003',
      attachment: {
        type: 'deferred_tools_delta',
        addedNames: ['SomeTool'],
        addedLines: ['SomeTool'],
        removedNames: [],
      },
    } as unknown as Message,
  ]
  const tools = [
    { name: 'OtherTool', isMcp: true },
  ] as unknown as Tools
  const delta = getDeferredToolsDelta(tools, messages)
  expect(delta).not.toBeNull()
  expect(delta!.removedNames).toEqual(['SomeTool'])
  expect(delta!.addedNames).toEqual(['OtherTool'])
})
