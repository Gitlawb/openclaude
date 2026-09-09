import { afterEach, expect, test } from 'bun:test'
import { setIsInteractive } from '../../bootstrap/state.js'
import { FreeTokensRequiredError, registerFreeTokenActivationPresenter, requestFreeTokenActivation } from './freeTokenActivation.js'

const stdinTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
const stdoutTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
let unregister: (() => void) | undefined
afterEach(() => {
  unregister?.(); unregister = undefined; setIsInteractive(false)
  if (stdinTTY) Object.defineProperty(process.stdin, 'isTTY', stdinTTY)
  else Reflect.deleteProperty(process.stdin, 'isTTY')
  if (stdoutTTY) Object.defineProperty(process.stdout, 'isTTY', stdoutTTY)
  else Reflect.deleteProperty(process.stdout, 'isTTY')
})
function tty() {
  Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true })
  Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true })
}
test('headless never presents or accepts a payment, even when a TTY exists', async () => {
  tty(); setIsInteractive(false)
  let calls = 0
  unregister = registerFreeTokenActivationPresenter(async () => { calls++; return false })
  expect(await requestFreeTokenActivation()).toBe(false)
  expect(calls).toBe(0)
  expect(new FreeTokensRequiredError()).toMatchObject({ code: 'free_tokens_exhausted', status: 402, activationUrl: 'https://code.verboo.ai/free-tokens' })
})
test('parallel agents share consent and a refusal suppresses late prompts', async () => {
  tty(); setIsInteractive(true)
  let finish!: (value: boolean) => void
  let calls = 0
  unregister = registerFreeTokenActivationPresenter(() => { calls++; return new Promise(resolve => { finish = resolve }) })
  const requestStartedAt = performance.now()
  const first = requestFreeTokenActivation({ requestStartedAt })
  const second = requestFreeTokenActivation({ requestStartedAt })
  expect(first).toBe(second); expect(calls).toBe(1)
  finish(false)
  expect(await first).toBe(false); expect(await second).toBe(false)
  expect(await requestFreeTokenActivation({ requestStartedAt })).toBe(false); expect(calls).toBe(1)
  // A new user request can present the choices immediately, with no command
  // or arbitrary cooldown after declining the previous request.
  const retry = requestFreeTokenActivation()
  expect(calls).toBe(2)
  finish(false)
  expect(await retry).toBe(false)
})
