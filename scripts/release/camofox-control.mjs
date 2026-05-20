#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const action = process.argv[2] || 'help'
const root = process.env.OPENCLAUDE_CAMOFOX_HOME || path.join(os.homedir(), '.openclaude', 'camofox-browser')
const pkgDir = path.join(root, 'node_modules', '@askjo', 'camofox-browser')
const serverJs = path.join(pkgDir, 'server.js')
const port = process.env.CAMOFOX_PORT || '9377'
const url = (process.env.CAMOFOX_URL || `http://localhost:${port}`).replace(/\/+$/, '')

if (action === 'help' || action === '-h' || action === '--help') {
  console.log(`OpenClaude Camofox helper

Usage:
  node scripts/release/camofox-control.mjs install
  node scripts/release/camofox-control.mjs start
  node scripts/release/camofox-control.mjs test

Environment:
  OPENCLAUDE_CAMOFOX_HOME=${root}
  CAMOFOX_PORT=${port}
  CAMOFOX_URL=${url}
  CAMOFOX_ACCESS_KEY=optional-bearer-token
`)
  process.exit(0)
}

if (action === 'install') {
  await install()
} else if (action === 'start') {
  await start()
} else if (action === 'test') {
  await test()
} else {
  console.error(`Unknown action: ${action}`)
  process.exit(2)
}

async function install() {
  await mkdir(root, { recursive: true })
  const packageJson = path.join(root, 'package.json')
  if (!existsSync(packageJson)) {
    await writeFile(packageJson, '{"private":true,"type":"commonjs"}\n', 'utf8')
  }

  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const result = spawnSync(npmCmd, ['install', '@askjo/camofox-browser@latest'], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.error) {
    console.error(result.error.message)
    process.exit(1)
  }
  process.exit(result.status || 0)
}

async function start() {
  if (!existsSync(serverJs)) {
    console.error(`Camofox is not installed in ${root}. Run install first.`)
    process.exit(1)
  }

  const child = spawn(process.execPath, [serverJs], {
    cwd: pkgDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      CAMOFOX_PORT: port,
    },
  })

  child.on('exit', code => process.exit(code || 0))
}

async function test() {
  const headers = {}
  const bearer = process.env.CAMOFOX_ACCESS_KEY || process.env.CAMOFOX_API_KEY
  if (bearer) headers.Authorization = `Bearer ${bearer}`

  const health = await fetchJson('/health', { headers })
  console.log(`health: ${JSON.stringify(health)}`)

  const created = await fetchJson('/tabs', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: 'openclaude-smoke',
      sessionKey: 'smoke',
      url: 'https://example.com',
    }),
  })
  console.log(`tab: ${JSON.stringify(created)}`)

  const tabId = created.tabId
  if (!tabId) throw new Error('Camofox did not return tabId')

  const params = new URLSearchParams({ userId: 'openclaude-smoke', format: 'text' })
  const snap = await fetchJson(`/tabs/${encodeURIComponent(tabId)}/snapshot?${params}`, { headers })
  const snapshot = String(snap.snapshot || snap).slice(0, 500)
  console.log(`snapshot: ${snapshot}`)

  await fetchJson(`/tabs/${encodeURIComponent(tabId)}`, {
    method: 'DELETE',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'openclaude-smoke' }),
  })
}

async function fetchJson(pathname, options = {}) {
  const response = await fetch(`${url}${pathname}`, options)
  const text = await response.text()
  let data = text
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = text
  }
  if (!response.ok) {
    const message = data?.error || data?.message || text || response.statusText
    throw new Error(`Camofox ${response.status}: ${message}`)
  }
  return data
}
