#!/usr/bin/env node

const { existsSync, readFileSync } = require('node:fs')
const { resolve } = require('node:path')

function readDotEnvValue(name) {
  const envPath = resolve(process.cwd(), '.env')
  if (!existsSync(envPath)) return undefined

  const envText = readFileSync(envPath, 'utf8')
  for (const line of envText.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (!match || match[1] !== name) continue
    return match[2].trim().replace(/^['"]|['"]$/g, '')
  }
  return undefined
}

function resolveToken() {
  const envToken = process.env.MCPR_TOKEN?.trim()
  const fileToken = readDotEnvValue('MCPR_TOKEN')?.trim()
  const host = (process.env.MCPR_HOST || '').trim().toLowerCase()
  const isDockerHost = host === 'host.docker.internal'

  return isDockerHost
    ? (envToken || fileToken)
    : (fileToken || envToken)
}

const token = resolveToken()
if (!token || token === '${MCPR_TOKEN}') {
  process.exit(1)
}

process.stdout.write(JSON.stringify({
  Authorization: `Bearer ${token}`,
}))
