import { describe, expect, test, beforeAll } from 'bun:test'
import adsCmd from './ads.js'
import { getGlobalConfig } from '../utils/config.js'

// Point the client at an unreachable host so the `on` path's live test tip
// fails fast and degrades to "enabled, no tip" — exercising config persistence
// without any real network. (bun test sets NODE_ENV=test, so saveGlobalConfig
// writes to the in-memory test config.)
beforeAll(() => {
  process.env.ADS_BASE_URL = 'http://127.0.0.1:0'
})

async function run(args: string): Promise<string> {
  const { call } = await adsCmd.load()
  const result = await call(args, {} as never)
  expect(result.type).toBe('text')
  return (result as { value: string }).value
}

describe('/ads command', () => {
  test('status shows off by default', async () => {
    expect(await run('')).toContain('off')
  })

  test('"on" without a code shows usage', async () => {
    expect(await run('on')).toContain('Usage')
  })

  test('"on <code>" enables and persists the earn code', async () => {
    const value = await run('on testcode123')
    expect(value.toLowerCase()).toContain('enabled')
    const ads = getGlobalConfig().ads
    expect(ads?.enabled).toBe(true)
    expect(ads?.earnCode).toBe('testcode123')
  })

  test('status reflects on after enabling', async () => {
    expect(await run('')).toContain('on')
  })

  test('"off" disables earning', async () => {
    expect((await run('off')).toLowerCase()).toContain('disabled')
    expect(getGlobalConfig().ads?.enabled).toBe(false)
  })
})
