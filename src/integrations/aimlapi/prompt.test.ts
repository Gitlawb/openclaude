import { afterEach, expect, mock, test } from 'bun:test'

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
