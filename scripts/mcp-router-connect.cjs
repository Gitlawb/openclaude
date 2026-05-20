#!/usr/bin/env node

const { spawn } = require('node:child_process')
const { existsSync, readFileSync } = require('node:fs')
const { resolve } = require('node:path')

function hydrateEnvFromDotEnv() {
  const envPath = resolve(process.cwd(), '.env')
  if (!existsSync(envPath)) return

  const envText = readFileSync(envPath, 'utf8')
  const preferDotEnv = new Set(['MCPR_TOKEN', 'MCPR_HOST', 'MCPR_PORT', 'MCPR_PROJECT'])
  for (const line of envText.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (!match) continue
    const [, key, rawValue] = match
    if (
      process.env[key] &&
      process.env[key] !== `\${${key}}` &&
      !preferDotEnv.has(key)
    ) {
      continue
    }
    process.env[key] = rawValue.trim().replace(/^['"]|['"]$/g, '')
  }
}

hydrateEnvFromDotEnv()

const connectArgs = [
  '-y',
  '@mcp_router/cli@latest',
  'connect',
  ...process.argv.slice(2),
]
const npxCommand = process.platform === 'win32' ? 'cmd.exe' : 'npx'
const args = process.platform === 'win32'
  ? ['/c', 'npx', ...connectArgs]
  : connectArgs

const child = spawn(npxCommand, args, {
  env: process.env,
  stdio: 'inherit',
  windowsHide: true,
})

child.on('error', error => {
  process.stderr.write(`Failed to start MCP Router CLI: ${error.message}\n`)
  process.exit(1)
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 0)
})
