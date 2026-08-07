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

test('getDeferredToolsDelta applies complete deferred_tools_delta records', () => {
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
  // Announced SomeTool is no longer in the pool → removal.
  const delta = getDeferredToolsDelta([] as Tools, messages)
  expect(delta).not.toBeNull()
  expect(delta!.removedNames).toEqual(['SomeTool'])
  expect(delta!.addedNames).toEqual([])
})
