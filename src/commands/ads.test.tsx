import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import type * as React from 'react'
import type * as ConfigModule from '../utils/config.js'

const ADS_TEST_CONFIG_URL = `../utils/config.js?adsTest=${Date.now()}-${Math.random()}`
const ORIGINAL_ADS_BASE_URL = process.env.ADS_BASE_URL

// Load the real config module through a unique URL specifier. mock.module() is
// process-global in bun:test and is NOT reliably undone by afterEach, so a
// leaked mock.module('../utils/config.js') from another suite can make these
// assertions read stale state or write into a no-op mock. A query-suffixed
// specifier is a different module key that mock.module never replaces, so we
// always get a reference to the real module here.
let realConfig: typeof ConfigModule

// In-memory config store isolated from the shared test config and from any
// leaked mocks. ads.tsx imports config.js via the bare specifier, so we install
// a controlled mock for that specifier while this file runs.
let testConfig: ConfigModule.GlobalConfig

beforeAll(async () => {
  realConfig = (await import(ADS_TEST_CONFIG_URL)) as typeof ConfigModule
})

beforeEach(() => {
  testConfig = { ...realConfig.DEFAULT_GLOBAL_CONFIG }
  mock.module('../utils/config.js', () => ({
    getGlobalConfig: () => testConfig,
    saveGlobalConfig: (
      updater: (current: ConfigModule.GlobalConfig) => ConfigModule.GlobalConfig,
    ) => {
      const next = updater(testConfig)
      if (next !== testConfig) {
        testConfig = next
      }
    },
  }))
  // Point at an unreachable host so nothing in these tests hits the network.
  process.env.ADS_BASE_URL = 'http://127.0.0.1:0'
})

afterEach(() => {
  mock.restore()
  if (ORIGINAL_ADS_BASE_URL === undefined) delete process.env.ADS_BASE_URL
  else process.env.ADS_BASE_URL = ORIGINAL_ADS_BASE_URL
})

afterAll(() => {
  // Restore the real config module for subsequent suites.
  mock.module('../utils/config.js', () => realConfig)
})

type RunResult = { text: string | undefined; node: React.ReactNode }

async function loadAds() {
  // Import ads.tsx through a unique URL so it resolves config.js against our
  // mock rather than a possibly-leaked mock from another suite.
  const { default: adsCmd } = await import(
    `./ads.js?adsTest=${Date.now()}-${Math.random()}`
  )
  return adsCmd.load()
}

async function run(args: string): Promise<RunResult> {
  const { call } = await loadAds()
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
    expect(testConfig.ads?.enabled).toBeFalsy()
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
    expect(testConfig.ads?.enabled).toBeFalsy()
  })

  test('"off" disables earning and clears the stored code', async () => {
    testConfig = {
      ...testConfig,
      ads: { enabled: true, earnCode: 'x' },
    }
    const { text } = await run('off')
    expect(text?.toLowerCase()).toContain('disabled')
    expect(testConfig.ads?.enabled).toBe(false)
    // The earn code is a credential — it must not survive opt-out.
    expect(testConfig.ads?.earnCode).toBeUndefined()
  })

  test('submitting the masked dialog enables earning and persists the code', async () => {
    const { call } = await loadAds()
    let text: string | undefined
    const node = await call((r?: string) => { text = r }, {} as never, 'on')
    const props = (node as React.ReactElement<{ onSubmit: (code: string) => void }>)
      .props
    props.onSubmit('earn_submitted')
    expect(testConfig.ads?.enabled).toBe(true)
    expect(testConfig.ads?.earnCode).toBe('earn_submitted')
    expect(text?.toLowerCase()).toContain('enabled')
  })

  test('cancelling the masked dialog leaves earning off', async () => {
    const { call } = await loadAds()
    let text: string | undefined
    const node = await call((r?: string) => { text = r }, {} as never, 'on')
    const props = (node as React.ReactElement<{ onCancel: () => void }>).props
    props.onCancel()
    expect(testConfig.ads?.enabled).toBeFalsy()
    expect(text?.toLowerCase()).toContain('cancel')
  })
})
