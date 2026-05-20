#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function hydrateEnvFromDotEnv() {
  const envPath = path.resolve(process.cwd(), '.env')
  if (!fs.existsSync(envPath)) return

  const envText = fs.readFileSync(envPath, 'utf8')
  for (const rawLine of envText.split(/\r?\n/)) {
    const match = rawLine.match(/^([A-Z0-9_]+)=(.*)$/)
    if (!match) continue
    const [, key, rawValue] = match
    if (process.env[key]) continue
    process.env[key] = rawValue.trim().replace(/^"(.*)"$/, '$1')
  }
}

hydrateEnvFromDotEnv()

const home = process.env.OPENCLAUDE_HINDSIGHT_HOME || path.join(os.homedir(), '.openclaude', 'hindsight')
const dataDir = process.env.HINDSIGHT_DATA_DIR || path.join(os.homedir(), '.hindsight-docker')
const apiPort = process.env.HINDSIGHT_API_PORT || '8888'
const uiPort = process.env.HINDSIGHT_UI_PORT || '9999'
const url = (process.env.HINDSIGHT_URL || `http://localhost:${apiPort}`).replace(/\/+$/, '')

function help() {
  console.log(`OpenClaude Hindsight helper

Usage:
  node scripts/release/hindsight-control.mjs install
  node scripts/release/hindsight-control.mjs docker-up
  node scripts/release/hindsight-control.mjs docker-down
  node scripts/release/hindsight-control.mjs test

Environment:
  OPENCLAUDE_HINDSIGHT_HOME=${home}
  HINDSIGHT_DATA_DIR=${dataDir}
  HINDSIGHT_URL=${url}
  HINDSIGHT_API_PORT=${apiPort}
  HINDSIGHT_UI_PORT=${uiPort}
  HINDSIGHT_API_LLM_API_KEY=<provider key used by Hindsight>
  HINDSIGHT_API_LLM_PROVIDER=openai|anthropic|gemini|groq|ollama|lmstudio|minimax
  HINDSIGHT_API_LLM_MODEL=<model>
  HINDSIGHT_BANK_ID=openclaude-agent
`)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)
}

function gitAvailable() {
  return spawnSync('git', ['--version'], { stdio: 'ignore', shell: process.platform === 'win32' }).status === 0
}

function dockerAvailable() {
  return spawnSync('docker', ['--version'], { stdio: 'ignore', shell: process.platform === 'win32' }).status === 0
}

function install() {
  if (!gitAvailable()) throw new Error('git is required to install Hindsight sources')
  fs.mkdirSync(path.dirname(home), { recursive: true })
  if (!fs.existsSync(path.join(home, '.git'))) {
    run('git', ['clone', '--depth', '1', 'https://github.com/vectorize-io/hindsight.git', home])
  } else {
    run('git', ['-C', home, 'pull', '--ff-only'])
  }
  console.log(`Hindsight source is ready: ${home}`)
}

function dockerUp() {
  if (!dockerAvailable()) throw new Error('Docker is required for Hindsight docker-up')
  fs.mkdirSync(dataDir, { recursive: true })
  const env = {
    ...process.env,
    HINDSIGHT_API_LLM_API_KEY: process.env.HINDSIGHT_API_LLM_API_KEY || process.env.OPENCLAUDE_API_KEY || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || '',
    HINDSIGHT_API_LLM_PROVIDER: process.env.HINDSIGHT_API_LLM_PROVIDER || process.env.OPENCLAUDE_PROVIDER || 'openai',
    HINDSIGHT_API_LLM_MODEL: process.env.HINDSIGHT_API_LLM_MODEL || process.env.OPENCLAUDE_MODEL || '',
  }
  const args = [
    'run',
    '--rm',
    '-d',
    '--pull',
    'always',
    '--name',
    process.env.HINDSIGHT_CONTAINER_NAME || 'openclaude-hindsight',
    '-p',
    `${apiPort}:8888`,
    '-p',
    `${uiPort}:9999`,
    '-e',
    `HINDSIGHT_API_LLM_API_KEY=${env.HINDSIGHT_API_LLM_API_KEY}`,
    '-e',
    `HINDSIGHT_API_LLM_PROVIDER=${env.HINDSIGHT_API_LLM_PROVIDER}`,
    '-v',
    `${dataDir}:/home/hindsight/.pg0`,
  ]
  if (env.HINDSIGHT_API_LLM_MODEL) {
    args.push('-e', `HINDSIGHT_API_LLM_MODEL=${env.HINDSIGHT_API_LLM_MODEL}`)
  }
  if (process.env.HINDSIGHT_API_LLM_BASE_URL) {
    args.push('-e', `HINDSIGHT_API_LLM_BASE_URL=${process.env.HINDSIGHT_API_LLM_BASE_URL}`)
  } else if (process.env.OPENCLAUDE_BASE_URL || process.env.OPENAI_BASE_URL || process.env.ANTHROPIC_BASE_URL) {
    args.push('-e', `HINDSIGHT_API_LLM_BASE_URL=${process.env.OPENCLAUDE_BASE_URL || process.env.OPENAI_BASE_URL || process.env.ANTHROPIC_BASE_URL}`)
  }
  args.push('ghcr.io/vectorize-io/hindsight:latest')
  run('docker', args, { env })
  console.log(`Hindsight API: http://localhost:${apiPort}`)
  console.log(`Hindsight UI:  http://localhost:${uiPort}`)
}

function dockerDown() {
  if (!dockerAvailable()) throw new Error('Docker is required for Hindsight docker-down')
  const name = process.env.HINDSIGHT_CONTAINER_NAME || 'openclaude-hindsight'
  const result = spawnSync('docker', ['rm', '-f', name], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.error) throw result.error
}

async function request(pathname, options = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Number(process.env.HINDSIGHT_MCP_TIMEOUT || 60) * 1000)
  try {
    const response = await fetch(`${url}${pathname}`, {
      ...options,
      signal: controller.signal,
      headers: {
        ...(process.env.HINDSIGHT_API_KEY ? { Authorization: `Bearer ${process.env.HINDSIGHT_API_KEY}` } : {}),
        ...(options.headers || {}),
      },
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`Hindsight ${response.status}: ${text || response.statusText}`)
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  } finally {
    clearTimeout(timer)
  }
}

async function test() {
  const bankId = encodeURIComponent(process.env.HINDSIGHT_BANK_ID || 'openclaude-agent')
  const content = `OpenClaude Hindsight smoke test at ${new Date().toISOString()}`
  await request(`/v1/default/banks/${bankId}/memories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      async: false,
      items: [{ content, context: 'openclaude smoke test', tags: ['openclaude', 'smoke'] }],
    }),
  })
  const recall = await request(`/v1/default/banks/${bankId}/memories/recall`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'OpenClaude Hindsight smoke test', budget: 'low' }),
  })
  console.log(JSON.stringify(recall, null, 2))
}

async function main() {
  const command = process.argv[2] || 'help'
  if (command === 'help' || command === '--help' || command === '-h') help()
  else if (command === 'install') install()
  else if (command === 'docker-up') dockerUp()
  else if (command === 'docker-down') dockerDown()
  else if (command === 'test') await test()
  else throw new Error(`Unknown command: ${command}`)
}

main().catch(error => {
  console.error(`[hindsight-control] ${error?.stack || error?.message || error}`)
  process.exit(1)
})
