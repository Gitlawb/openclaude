import { mock } from 'bun:test'
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  getClaudeConfigHomeDir,
  setClaudeConfigHomeDirForTesting,
} from '../../utils/envUtils.js'
import { getGlobalClaudeFile } from '../../utils/env.js'
import * as lockfile from '../../utils/lockfile.js'

const configDir = realpathSync(
  mkdtempSync(join(tmpdir(), 'openclaude-global-config-release-failure-')),
)
const previousNodeEnv = process.env.NODE_ENV
const previousOpenClaudeConfigDir = process.env.OPENCLAUDE_CONFIG_DIR
let injectReleaseFailure = true

mock.module('../../utils/lockfile.js', () => ({
  ...lockfile,
  lockSync(...args: Parameters<typeof lockfile.lockSync>) {
    const release = lockfile.lockSync(...args)
    return () => {
      release()
      if (injectReleaseFailure) {
        injectReleaseFailure = false
        throw Object.assign(new Error('injected release failure'), {
          code: 'EIO',
        })
      }
    }
  },
}))

try {
  process.env.NODE_ENV = 'production'
  process.env.OPENCLAUDE_CONFIG_DIR = configDir
  setClaudeConfigHomeDirForTesting(configDir)
  getClaudeConfigHomeDir.cache?.clear?.()
  getGlobalClaudeFile.cache?.clear?.()

  let updaterCalls = 0
  let persisted: boolean | undefined
  try {
    const config = await import('../../utils/config.js')
    config.enableConfigs()
    config.getGlobalConfig()
    persisted = config.saveGlobalConfig(current => {
      updaterCalls++
      return { ...current, promptQueueUseCount: 1 }
    })
    const configPath = join(configDir, '.openclaude.json')
    if (process.argv[2] === 'missing-config') {
      rmSync(configPath, { force: true })
    }
    const onDisk = JSON.parse(readFileSync(configPath, 'utf8'))
    const cached = config.getGlobalConfig()

    process.stdout.write(
      JSON.stringify({
        persisted,
        updaterCalls,
        onDiskValue: onDisk.promptQueueUseCount,
        cachedValue: cached.promptQueueUseCount,
      }),
    )
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        persisted,
        updaterCalls,
        error: error instanceof Error ? error.message : String(error),
      }),
    )
    throw error
  }
} finally {
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = previousNodeEnv
  if (previousOpenClaudeConfigDir === undefined) {
    delete process.env.OPENCLAUDE_CONFIG_DIR
  } else {
    process.env.OPENCLAUDE_CONFIG_DIR = previousOpenClaudeConfigDir
  }
  setClaudeConfigHomeDirForTesting(undefined)
  getClaudeConfigHomeDir.cache?.clear?.()
  getGlobalClaudeFile.cache?.clear?.()
  rmSync(configDir, { recursive: true, force: true })
}
