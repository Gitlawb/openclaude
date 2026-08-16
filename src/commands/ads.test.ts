import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type * as React from 'react'
import adsCmd from './ads.js'
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js'

const ORIGINAL_ADS_BASE_URL = process.env.ADS_BASE_URL
const ORIGINAL_ADS_CONFIG = getGlobalConfig().ads

// Point at an unreachable host so nothing in these tests hits the network.
// (bun test sets NODE_ENV=test, so saveGlobalConfig writes in-memory.)
beforeEach(() => {
  process.env.ADS_BASE_URL = 'http://127.0.0.1:0'
  saveGlobalConfig(c => ({ ...c, ads: undefined }))
})

// Restore env + global ads config so neither leaks into other suites in the run.
afterEach(() => {
  saveGlobalConfig(c => ({ ...c, ads: ORIGINAL_ADS_CONFIG }))
  if (ORIGINAL_ADS_BASE_URL === undefined) delete process.env.ADS_BASE_URL
  else process.env.ADS_BASE_URL = ORIGINAL_ADS_BASE_URL
})

type RunResult = { text: string | undefined; node: React.ReactNode }

async function run(args: string): Promise<RunResult> {
  const { call } = await adsCmd.load()
  let text: string | undefined
  const onDone = (result?: string): void => {
    text = result
  }
  const node = await call(onDone, {} as never, args)
  return { text, node }
}

describe('/ads command', () => {
  test('status shows off by default', async () => {
    const { text } = await run('')
    expect(text).toContain('off')
  })

  test('"on" returns the masked dialog and does not enable yet', async () => {
    const { node, text } = await run('on')
    expect(node).toBeTruthy() // renders AdsCodeDialog
    expect(text).toBeUndefined() // resolves only after the user submits
    expect(getGlobalConfig().ads?.enabled).toBeFalsy()
  })

  test('"on <code>" never enables inline — it also opens the masked dialog', async () => {
    const { node, text } = await run('on earn_typed_inline')
    expect(node).toBeTruthy()
    expect(text).toBeUndefined()
    // A code typed inline is already exposed → the dialog must warn to rotate it.
    expect(
      (node as React.ReactElement<{ warnExposed?: boolean }>).props.warnExposed,
    ).toBe(true)
    // The inline code is ignored; nothing is persisted from the command line.
    expect(getGlobalConfig().ads?.enabled).toBeFalsy()
  })

  test('"off" disables earning and clears the stored code', async () => {
    saveGlobalConfig(c => ({ ...c, ads: { enabled: true, earnCode: 'x' } }))
    const { text } = await run('off')
    expect(text?.toLowerCase()).toContain('disabled')
    expect(getGlobalConfig().ads?.enabled).toBe(false)
    // The earn code is a credential — it must not survive opt-out.
    expect(getGlobalConfig().ads?.earnCode).toBeUndefined()
  })

  test('submitting the masked dialog enables earning and persists the code', async () => {
    const { call } = await adsCmd.load()
    let text: string | undefined
    const node = await call((r?: string) => { text = r }, {} as never, 'on')
    const props = (node as React.ReactElement<{ onSubmit: (code: string) => void }>)
      .props
    props.onSubmit('earn_submitted')
    expect(getGlobalConfig().ads?.enabled).toBe(true)
    expect(getGlobalConfig().ads?.earnCode).toBe('earn_submitted')
    expect(text?.toLowerCase()).toContain('enabled')
  })

  test('cancelling the masked dialog leaves earning off', async () => {
    const { call } = await adsCmd.load()
    let text: string | undefined
    const node = await call((r?: string) => { text = r }, {} as never, 'on')
    const props = (node as React.ReactElement<{ onCancel: () => void }>).props
    props.onCancel()
    expect(getGlobalConfig().ads?.enabled).toBeFalsy()
    expect(text?.toLowerCase()).toContain('cancel')
  })
})
