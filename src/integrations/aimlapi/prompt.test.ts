import { afterEach, expect, mock, test } from 'bun:test'
import type { createInterface } from 'node:readline'

import { promptText } from './prompt.js'

const originalIsTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')

afterEach(() => {
  if (originalIsTTY) {
    Object.defineProperty(process.stdin, 'isTTY', originalIsTTY)
  } else {
    Reflect.deleteProperty(process.stdin, 'isTTY')
  }
})

function setInteractive(): void {
  Object.defineProperty(process.stdin, 'isTTY', {
    configurable: true,
    value: true,
  })
}

test('promptText trims answers and closes readline', async () => {
  setInteractive()
  const close = mock(() => {})
  const createReadline = mock(() => ({
    question: (_question: string, resolve: (answer: string) => void) =>
      resolve('  answer  '),
    close,
  }))

  await expect(promptText('Question', {}, createReadline)).resolves.toBe('answer')
  expect(close).toHaveBeenCalledTimes(1)
})

test('promptText uses the default for an empty answer', async () => {
  setInteractive()
  const close = mock(() => {})
  const createReadline = mock(() => ({
    question: (_question: string, resolve: (answer: string) => void) => resolve('   '),
    close,
  }))

  await expect(
    promptText('Question', { defaultValue: 'default' }, createReadline),
  ).resolves.toBe('default')
  expect(close).toHaveBeenCalledTimes(1)
})

test('promptText closes readline when question fails', async () => {
  setInteractive()
  const close = mock(() => {})
  const createReadline = mock(() => ({
    question: () => {
      throw new Error('readline failed')
    },
    close,
  }))

  await expect(promptText('Question', {}, createReadline)).rejects.toThrow(
    'readline failed',
  )
  expect(close).toHaveBeenCalledTimes(1)
})

test('promptText masks secret input from terminal output', async () => {
  setInteractive()
  const written: string[] = []
  const output = {
    columns: 80,
    write: (chunk: string) => written.push(chunk),
  }
  const createReadline = mock((options: Parameters<typeof createInterface>[0]) => ({
    question: (_question: string, resolve: (answer: string) => void) => {
      options.output?.write('123456')
      resolve('123456')
    },
    close: () => {},
  }))

  await expect(
    promptText('6-digit code', { mask: true }, createReadline, output),
  ).resolves.toBe('123456')
  expect(written.join('')).toBe('6-digit code: \n')
})
