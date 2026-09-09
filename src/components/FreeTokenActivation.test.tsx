import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import React, { act } from 'react'
import stripAnsi from 'strip-ansi'
import { createRoot } from '../ink.js'
import type { FreeTokenStatus } from '../services/api/verbooFreeTokens.js'
import { FreeTokenActivationView } from './FreeTokenActivation.js'

const exhausted: FreeTokenStatus = {
  eligible: false, state: 'exhausted', tokenLimit: 1000, tokensUsed: 1000,
  tokensRemaining: 0, accountingPending: false,
  activationUrl: 'https://example.invalid/free-tokens',
}
const quote = {
  token: 'accepted-server-quote', groupId: '11111111-1111-4111-8111-111111111111',
  groupName: 'Plano Code', amountCents: 1000, renewalAmountCents: 2000,
  currency: 'BRL', billingInterval: 'month' as const, expiresAt: '2030-01-01T00:00:00Z',
}
const cleanups: Array<() => void> = []
const reactTestEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
const previousActEnvironment = reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT
beforeEach(() => { reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true })
afterEach(async () => {
  await act(async () => { for (const cleanup of cleanups.splice(0)) cleanup() })
  reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
})

async function waitFor(condition: () => boolean) {
  const deadline = performance.now() + 2000
  while (!condition()) {
    if (performance.now() > deadline) throw new Error('Timed out waiting for activation choices')
    await Bun.sleep(10)
  }
}

async function activationMenu(result: FreeTokenStatus = { ...exhausted, state: 'converted' }, initial = exhausted) {
  const dependencies = {
    fetchFreeTokenStatus: mock(async () => initial),
    fetchFreeTokenQuote: mock(async () => quote),
    activateFreeTokens: mock(async (_token: string, _signal?: AbortSignal) => result),
    openBrowser: mock(async (_url: string) => true),
  }
  const onDone = mock((_activated: boolean) => {})
  const stdout = new PassThrough()
  const stdin = Object.assign(new PassThrough(), {
    isTTY: true, setRawMode: (_mode: boolean) => {}, ref: () => {}, unref: () => {},
  })
  Object.assign(stdout, { columns: 140 })
  let output = ''
  stdout.on('data', chunk => { output += chunk.toString() })
  const root = await createRoot({
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream, patchConsole: false,
  })
  cleanups.push(() => { root.unmount(); stdin.end(); stdout.end() })
  await act(async () => { root.render(<FreeTokenActivationView dependencies={dependencies} onDone={onDone} />) })
  // Flush React's effects before sending keys so the test also waits for the
  // selection handlers, which can be installed after the first visible frame.
  const press = async (key: string) => { await act(async () => { stdin.write(key) }) }
  return { dependencies, onDone, press, output: () => stripAnsi(output) }
}

test('explains exhaustion and lets the user decline with arrow keys without charging', async () => {
  const menu = await activationMenu()
  await waitFor(() => menu.output().includes('Ativar plano e pagar'))
  const text = menu.output().replace(/\s+/g, ' ')
  expect(text).toContain('Seus tokens grátis acabaram e a inferência foi pausada.')
  expect(text).toContain('R$ 10,00 agora no cartão cadastrado')
  expect(text).toContain('Renovação por R$ 20,00/mês até cancelar')
  expect(text).toContain('Agora não')
  expect(menu.dependencies.activateFreeTokens).not.toHaveBeenCalled()
  await menu.press('\x1B[B')
  await menu.press('\r')
  await waitFor(() => menu.onDone.mock.calls.length > 0)
  expect(menu.onDone).toHaveBeenCalledWith(false)
  expect(menu.dependencies.activateFreeTokens).not.toHaveBeenCalled()
  expect(menu.dependencies.openBrowser).not.toHaveBeenCalled()
})

test('activates with the quoted saved-card price only after selecting acceptance', async () => {
  const menu = await activationMenu()
  await waitFor(() => menu.output().includes('Ativar plano e pagar'))
  expect(menu.dependencies.activateFreeTokens).not.toHaveBeenCalled()
  await menu.press('\r')
  await waitFor(() => menu.onDone.mock.calls.length > 0)
  expect(menu.dependencies.activateFreeTokens).toHaveBeenCalledTimes(1)
  expect(menu.dependencies.activateFreeTokens).toHaveBeenCalledWith(quote.token, expect.any(AbortSignal))
  expect(menu.onDone).toHaveBeenCalledWith(true)
  expect(menu.dependencies.openBrowser).not.toHaveBeenCalled()
})

test('opens Stripe when activation requires another card action', async () => {
  const checkoutUrl = 'https://checkout.stripe.com/test-fallback'
  const menu = await activationMenu({ ...exhausted, state: 'checkout_required', checkoutUrl })
  await waitFor(() => menu.output().includes('Ativar plano e pagar'))
  await menu.press('\r')
  await waitFor(() => menu.output().includes('Abrir Stripe'))
  expect(menu.dependencies.openBrowser).toHaveBeenCalledWith(checkoutUrl)
  expect(menu.onDone).not.toHaveBeenCalled()
})

test('continues without a payment prompt when the block has already cleared', async () => {
  const menu = await activationMenu(undefined, { ...exhausted, state: 'active', tokensUsed: 900, tokensRemaining: 100 })
  await waitFor(() => menu.onDone.mock.calls.length > 0)
  expect(menu.onDone).toHaveBeenCalledWith(true)
  expect(menu.dependencies.fetchFreeTokenQuote).not.toHaveBeenCalled()
  expect(menu.dependencies.activateFreeTokens).not.toHaveBeenCalled()
})
